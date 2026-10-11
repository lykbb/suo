import { readFile, readdir, mkdir, open, link, unlink, stat } from 'node:fs/promises';
import { lockedSerial } from './queue.mjs';
import { retainVersions } from './trash.mjs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createConnectionFetch, supportsPublicRoute } from './network.mjs';

const number = value => Number.isSafeInteger(value) && value > 0 ? value : undefined;
// Only public model metadata can cross this boundary. Never return URLs, headers or keys.
export function publicModels(config) {
  const result = [], seen = new Set();
  for (const [provider, entry] of Object.entries(config?.providers ?? {})) {
    if (!provider || provider.length > 80 || !Array.isArray(entry?.models)) continue;
    for (const model of entry.models) {
      if (!model || typeof model.id !== 'string' || !model.id.trim() || model.id.length > 240) continue;
      const key = JSON.stringify([provider, model.id]);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ provider, id: model.id, name: typeof model.name === 'string' && model.name.trim() ? model.name.slice(0, 240) : model.id, contextWindow: number(model.contextWindow), maxTokens: number(model.maxTokens), supportsImages: model.input?.includes('image') === true });
      if (result.length === 200) return result;
    }
  }
  return result;
}

const APIS = new Set(['openai-completions', 'openai-responses', 'anthropic-messages']);
const validString = (value, max = 240) => typeof value === 'string' && value.trim() && value.length <= max && !/[\x00-\x1f]/u.test(value);
const positive = (value, fallback, max) => Number.isSafeInteger(value) && value > 0 && value <= max ? value : fallback;
const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

// Accept literal credentials and known transports only. Never execute models.json commands.
export function normalizeConnections(raw) {
  const providers = {};
  for (const [id, entry] of Object.entries(raw?.providers ?? {}).slice(0, 40)) {
    if (!/^[a-zA-Z0-9_.-]{1,80}$/u.test(id) || !APIS.has(entry?.api)) continue;
    let url;
    try { url = new URL(entry.baseUrl); } catch { continue; }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) continue;
    if (!validString(entry.apiKey, 4096) || entry.apiKey.startsWith('!')) continue;
    const models = [];
    for (const item of (Array.isArray(entry.models) ? entry.models : []).slice(0, 200)) {
      if (!validString(item?.id) || (item.type && item.type !== 'chat')) continue;
      models.push({
        id: item.id, name: validString(item.name) ? item.name : item.id,
        reasoning: item.reasoning === true, input: item.input?.includes('image') ? ['text', 'image'] : ['text'],
        cost, contextWindow: positive(item.contextWindow, 32768, 10000000),
        maxTokens: positive(item.maxTokens, 4096, 1000000),
        ...(item.compat && typeof item.compat === 'object' ? { compat: Object.fromEntries(Object.entries(item.compat).filter(([key, value]) => ['supportsStore', 'supportsDeveloperRole', 'supportsReasoningEffort', 'supportsUsageInStreaming', 'supportsStrictMode', 'maxTokensField'].includes(key) && (typeof value === 'boolean' || ['max_tokens', 'max_completion_tokens'].includes(value)))) } : {}),
      });
    }
    if (models.length) providers[id] = { api: entry.api, baseUrl: url.href.replace(/\/$/u, ''), apiKey: entry.apiKey, models, ...(entry.network === 'funnel-public' && supportsPublicRoute(url.href) ? { network: 'funnel-public' } : {}) };
  }
  const selected = raw?.selected;
  const validSelection = typeof selected?.provider === 'string' && typeof selected?.id === 'string' && providers[selected.provider]?.models.some(item => item.id === selected.id);
  const drafts = {};
  for (const [id, draft] of Object.entries(raw?.drafts ?? {}).slice(-40)) {
    if (!/^[a-f0-9-]{36}$/u.test(id) || !APIS.has(draft?.api)) continue;
    const safe = (value, max) => typeof value === 'string' && value.length <= max && !/[\x00-\x1f]/u.test(value) ? value : '';
    drafts[id] = { baseUrl: safe(draft.baseUrl, 2000), modelId: safe(draft.modelId, 240), apiKey: safe(draft.apiKey, 4096), api: draft.api,
      network: draft.network === 'funnel-public' ? 'funnel-public' : 'default', supportsImages: draft.supportsImages === true,
      ...(Object.hasOwn(providers, draft.provider) ? { provider: draft.provider } : {}),
      ...(Object.hasOwn(providers, draft.provider) && validString(draft.editModelId) ? { editModelId: draft.editModelId } : {}),
      warning: safe(draft.warning, 2000) || '尚未完成连接检查。' };
  }
  return { providers, ...(Object.keys(drafts).length ? { drafts } : {}), ...(validSelection ? { selected: { provider: selected.provider, id: selected.id } } : {}) };
}

// Best is a stable automatic choice, not a model-quality ranking or a retry policy.
export function defaultModel(config) {
  const models = publicModels(config);
  const selected = models.find(item => item.provider === config?.selected?.provider && item.id === config.selected.id) ?? models[0];
  return selected ? { provider: selected.provider, id: selected.id } : undefined;
}

async function readConfig(path) {
  if ((await stat(path)).size > 1024 * 1024) throw new Error('模型配置文件过大。');
  try { return normalizeConnections(JSON.parse(await readFile(path, 'utf8'))); }
  catch { throw new Error('模型配置格式无效。'); }
}

// A free model-list request before saving. A wrong key or a model the endpoint no longer offers is
// refused with the models it does offer; an endpoint that is unreachable or has no list is saved
// anyway, with a warning. Messages never contain the address or the key.
export async function checkConnection({ api, baseUrl, apiKey, modelId, network }, fetchImpl = globalThis.fetch) {
  const headers = api === 'anthropic-messages' ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } : { Authorization: `Bearer ${apiKey}` };
  let response;
  try { response = await createConnectionFetch({ baseUrl, network }, { fetchImpl })(`${baseUrl}/models`, { headers, signal: AbortSignal.timeout(8000) }); }
  catch (error) { return { warning: `连接已保存，但现在连不上这个接口（${error?.cause?.code ?? error?.name ?? '网络错误'}），发送前请检查网络或接口地址。` }; }
  if (response.status === 401 || response.status === 403) throw new Error(`API Key 无效或没有权限（HTTP ${response.status}），连接未保存。`);
  if (!response.ok) return {};
  let ids;
  try { ids = (await response.json())?.data?.map(item => item?.id).filter(id => typeof id === 'string'); } catch { return {}; }
  if (!ids?.length || ids.includes(modelId)) return {};
  throw new Error(`这个接口没有「${modelId}」，连接未保存。可用的模型：${ids.slice(0, 12).join('、')}${ids.length > 12 ? ' 等' : ''}`);
}

export class Connections {
  constructor({ root, dataRoot, fetch: fetchImpl = globalThis.fetch }) { this.root = root; this.dataRoot = dataRoot; this.directory = join(dataRoot, 'connections'); this.fetch = fetchImpl; }
  async load() {
    let names = [];
    try { names = (await readdir(this.directory)).filter(name => /^\d{13}-[a-f0-9-]{36}\.json$/u.test(name)).sort().reverse(); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('无法读取模型配置。'); }
    const paths = [...names.map(name => join(this.directory, name)), join(this.dataRoot, 'agent/models.json'), join(this.root, 'state/agent/models.json')];
    for (const path of paths) {
      try { return await readConfig(path); }
      catch (error) { if (!names.some(name => path.endsWith(name)) && error.code !== 'ENOENT') throw new Error('模型配置读取失败，请在设置中重新配置。'); }
    }
    return { providers: {} };
  }
  async list() {
    return connectionCatalog(await this.load());
  }
  async configure(payload) { return lockedSerial(this.directory, () => this.configureLocked(payload)); }
  async configureLocked(payload) {
    if (!validString(payload?.baseUrl, 2000) || !validString(payload?.modelId)) throw new Error('请填写接口地址和模型名称。');
    const current = await this.load();
    const draftId = payload.draftId ?? randomUUID();
    if (!/^[a-f0-9-]{36}$/u.test(draftId)) throw new Error('连接记录无效。');
    const oldDraft = current.drafts?.[draftId];
    const originalProvider = payload.provider ?? oldDraft?.provider;
    const sameTarget = entry => { try { return entry?.api === (payload.api ?? 'openai-completions') && new URL(entry.baseUrl).href.replace(/\/$/u, '') === new URL(payload.baseUrl).href.replace(/\/$/u, ''); } catch { return false; } };
    const original = current.providers[originalProvider];
    const matching = Object.values(current.providers).find(sameTarget);
    const inheritedKey = (sameTarget(oldDraft) ? oldDraft.apiKey : '') || (sameTarget(original) ? original.apiKey : '') || (!originalProvider && sameTarget(matching) ? matching.apiKey : '');
    const draft = { baseUrl: payload.baseUrl.trim(), modelId: payload.modelId.trim(), api: payload.api ?? 'openai-completions', network: payload.network ?? 'default',
      apiKey: payload.apiKey || inheritedKey || '', supportsImages: payload.supportsImages ?? oldDraft?.supportsImages ?? false,
      ...(originalProvider ? { provider: originalProvider } : {}),
      ...(payload.editModelId ?? oldDraft?.editModelId ? { editModelId: payload.editModelId ?? oldDraft.editModelId } : {}), warning: '尚未完成连接检查。' };
    if (!APIS.has(draft.api) || (draft.apiKey && !validString(draft.apiKey, 4096))) throw new Error('请检查 API Key 和接口类型。');
    const drafts = { ...current.drafts, [draftId]: draft };
    try {
      const normalizedUrl = new URL(payload.baseUrl).href.replace(/\/$/u, '');
      if (!draft.apiKey) throw new Error('接口地址或类型已改变，请填写该接口的 API Key；原密钥不会发送到新地址。');
      if (originalProvider && !current.providers[originalProvider]) throw new Error('原连接不存在，请重新添加。');
      const provider = originalProvider ?? Object.entries(current.providers).find(([, entry]) => entry.baseUrl === normalizedUrl && entry.api === draft.api)?.[0] ?? `custom-${randomUUID().slice(0, 8)}`;
      const previous = current.providers[provider];
      const apiKey = draft.apiKey || (previous?.baseUrl === normalizedUrl ? previous.apiKey : '');
      const models = previous?.models ?? [];
      const modelId = payload.modelId.trim();
      const editId = draft.editModelId;
      if (editId && !models.some(item => item.id === editId)) throw new Error('原模型记录已变化，请重新打开记录。');
      if (editId && editId !== modelId && models.some(item => item.id === modelId)) throw new Error('这个模型已经有记录，请直接打开它修改。');
      const oldModel = models.find(item => item.id === (editId ?? modelId));
      const nextModel = { ...oldModel, input: payload.supportsImages === undefined ? oldModel?.input ?? ['text'] : payload.supportsImages ? ['text', 'image'] : ['text'], id: modelId, name: payload.name || (oldModel?.name && oldModel.name !== oldModel.id ? oldModel.name : modelId) };
      const next = normalizeConnections({ providers: { [provider]: {
        baseUrl: payload.baseUrl, apiKey, api: payload.api ?? 'openai-completions',
        network: payload.network,
        models: [...models.filter(item => item.id !== modelId && item.id !== editId), nextModel],
      } } });
      if (!next.providers[provider]) throw new Error('请检查接口地址、API Key 和接口类型。');
      if (payload.network === 'funnel-public' && !supportsPublicRoute(normalizedUrl)) throw new Error('公网连接仅支持 HTTPS 的 Tailscale Funnel 地址。');
      const { baseUrl, api } = next.providers[provider];
      const check = await checkConnection({ api, baseUrl, apiKey, modelId, network: next.providers[provider].network }, this.fetch);
      delete drafts[draftId];
      return { ...await this.saveLocked({ ...current, drafts, providers: { ...current.providers, ...next.providers }, selected: { provider, id: modelId } }), ...check };
    } catch (error) {
      drafts[draftId].warning = error.code === 'ERR_INVALID_URL' ? '接口地址格式不正确，请填写完整的 http 或 https 地址。' : error.message;
      await this.saveLocked({ ...current, drafts });
      throw new Error(`${drafts[draftId].warning} 配置草稿已保留，可打开记录修改。`);
    }
  }
  async import(path) { return lockedSerial(this.directory, async () => { const next = await readConfig(path); if (!publicModels(next).length) throw new Error('未找到可用的模型连接。支持 OpenAI 和 Anthropic 的直接 API Key 配置。'); return this.saveLocked(next); }); }
  async save(next) { return lockedSerial(this.directory, () => this.saveLocked(next)); }
  async saveLocked(next) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const names = await readdir(this.directory);
    const latest = Math.max(0, ...names.filter(name => /^\d{13}-[a-f0-9-]{36}\.json$/u.test(name)).map(name => Number(name.slice(0, 13))));
    const timestamp = Math.max(Date.now(), latest + 1);
    // Append a version instead of overwriting credentials; never put keys in workspaces or bundles.
    const name = `${timestamp}-${randomUUID()}.json`, scratch = join(this.directory, `.pending-${randomUUID()}`);
    const handle = await open(scratch, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(next)); await handle.sync(); } finally { await handle.close(); }
    try { await link(scratch, join(this.directory, name)); } finally { await unlink(scratch); }
    try { await retainVersions(this.directory, /^\d{13}-[a-f0-9-]{36}\.json$/u, 3, name, value => value?.providers && typeof value.providers === 'object'); } catch { console.warn('Suo: 连接已保存，旧版本暂未整理。'); }
    return connectionCatalog(next);
  }
}

function publicDraftUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.username = ''; url.password = ''; url.search = ''; url.hash = '';
    return url.href.replace(/\/$/u, '');
  } catch {
    const address = String(value ?? '').split(/[?#]/u)[0];
    const at = address.lastIndexOf('@');
    return at < 0 ? address : `${address.match(/^https?:\/\//u)?.[0] ?? ''}${address.slice(at + 1)}`;
  }
}

export function connectionCatalog(config) {
  const models = publicModels(config);
  const connections = Object.entries(config.providers).map(([provider, { baseUrl, api, network }]) => ({ provider, baseUrl, api, network: network ?? 'default' }));
  const selected = defaultModel(config);
  const drafts = Object.entries(config.drafts ?? {}).map(([id, { apiKey, ...draft }]) => ({ id, ...draft, baseUrl: publicDraftUrl(draft.baseUrl), hasKey: !!apiKey }));
  return { models, connections, drafts, mode: models.length ? 'ready' : 'unconfigured', ...(selected ? { selected } : {}) };
}
