import { useEffect, useRef, useState } from 'react';
import { chooseModelConfig, native, openExternal, request } from './bridge';
import { update } from './actions';
import { PRESETS, presetFor, recommendedModel } from './modelPresets';
import { app } from './state';
import type { ModelCatalog, ModelChoice, ModelDraft } from './types';
import './ModelSettings.css';

// Results of "测试连接" for this App session, shown on the saved models.
type Check = { ok: boolean; tools?: boolean; ms?: number; message?: string };
const checks = new Map<string, Check>();
const checkLabel = (check?: Check) => !check ? '已保存' : !check.ok ? '不可用' : check.tools ? '可用' : '仅对话';
const message = (error: unknown, fallback: string) => error instanceof Error && error.message ? error.message : fallback;

export default function ModelSettings() {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [provider, setProvider] = useState<string>(), [baseUrl, setUrl] = useState(''), [modelId, setModel] = useState(''), [apiKey, setKey] = useState('');
  const [api, setApi] = useState('openai-completions'), [network, setNetwork] = useState<'default' | 'funnel-public'>('default');
  const [draftId, setDraftId] = useState<string>(), [editModelId, setEditModelId] = useState<string>(), [draftHasKey, setDraftHasKey] = useState(false);
  const [supportsImages, setImages] = useState(false);
  const [originalTarget, setOriginalTarget] = useState('');
  // A new connection starts from a service: its address and API type are filled in, and the model
  // is chosen from the service's own list once the key is in.
  const [preset, setPreset] = useState(PRESETS[0].id), [models, setModels] = useState<string[]>([]), [listing, setListing] = useState(false), [listNote, setListNote] = useState('');
  // A listed model is picked from a full dropdown; typing is for models the service does not list.
  const [manual, setManual] = useState(false);
  const listingVersion = useRef(0);
  const target = (url: string, kind: string) => { try { return kind + ':' + new URL(url).href.replace(/\/$/, ''); } catch { return ''; } };
  const targetChanged = !!originalTarget && target(baseUrl, api) !== originalTarget;
  const [saving, setSaving] = useState(false), [checking, setChecking] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState('');
  const busy = app.use(state => state.busy);
  const adding = !provider && !draftId, service = adding ? PRESETS.find(item => item.id === preset) : presetFor(baseUrl);
  const publicRoute = (() => { try { const url = new URL(baseUrl); return url.protocol === 'https:' && /^[a-z0-9-]+\.[a-z0-9.-]+\.ts\.net$/i.test(url.hostname) && ['', '443', '8443', '10000'].includes(url.port); } catch { return false; } })();
  useEffect(() => { let live = true; request<ModelCatalog>('models.list').then(value => { if (live) { setCatalog(value); select(value.models.find(item => item.provider === value.selected?.provider && item.id === value.selected.id) ?? value.models[0], value); } }).catch(() => { if (live) setError('模型配置暂时读不到。'); }); return () => { live = false; listingVersion.current++; }; }, []);
  function resetList() { listingVersion.current++; setListing(false); setModels([]); setListNote(''); setManual(false); }
  function select(item?: ModelChoice, value = catalog) {
    const connection = value?.connections?.find(entry => entry.provider === item?.provider);
    setProvider(connection?.provider); setApi(connection?.api ?? PRESETS[0].api); setUrl(connection?.baseUrl ?? PRESETS[0].baseUrl); setPreset(PRESETS[0].id);
    setModel(item?.id ?? ''); setKey(''); setNetwork(connection?.network ?? 'default'); setError(''); setSaved(''); resetList();
    setImages(item?.supportsImages ?? false); setOriginalTarget(connection ? target(connection.baseUrl, connection.api) : '');
    setDraftId(undefined); setEditModelId(item?.id); setDraftHasKey(false);
  }
  function selectDraft(item: ModelDraft) {
    setDraftId(item.id); setEditModelId(item.editModelId); setProvider(item.provider); setUrl(item.baseUrl); setModel(item.modelId); setApi(item.api); setNetwork(item.network);
    setImages(item.supportsImages ?? false); setOriginalTarget(target(item.baseUrl, item.api));
    setKey(''); setDraftHasKey(item.hasKey); setError(item.warning); setSaved(''); resetList();
  }
  function pickPreset(id: string) {
    const item = PRESETS.find(entry => entry.id === id);
    const sameTarget = !!item && target(item.baseUrl, item.api) === target(baseUrl, api);
    setPreset(id); setModel(''); setError(''); setSaved(''); resetList();
    if (!sameTarget) setKey('');
    if (!item) { setUrl(''); setApi('openai-completions'); return; }
    setUrl(item.baseUrl); setApi(item.api);
    if (sameTarget && apiKey.trim()) void discover();
  }
  async function discover() {
    const at = { api, baseUrl }, version = ++listingVersion.current;
    if (!at.baseUrl.trim()) { setListNote('请先选择服务商，或填写接口地址。'); return; }
    setListing(true); setListNote('');
    try {
      const result = await request<{ models: string[] }>('models.discover', { provider, draftId, api: at.api, baseUrl: at.baseUrl.trim(), apiKey: apiKey.trim(), network: publicRoute ? network : 'default' });
      if (version !== listingVersion.current) return;
      const pick = recommendedModel(presetFor(at.baseUrl), result.models);
      setModels(result.models); setManual(false);
      setModel(current => current.trim() || pick || '');
      setListNote(`读取到 ${result.models.length} 个可用型号${pick ? `，推荐 ${pick}` : ''}，可以在「模型」里换。`);
    } catch (error) { if (version === listingVersion.current) { setModels([]); setListNote(message(error, '没能读取型号，请手动填写模型名称。')); } }
    finally { if (version === listingVersion.current) setListing(false); }
  }
  function accept(value: ModelCatalog) {
    const choice = value.models.find(item => item.provider === value.selected?.provider && item.id === value.selected.id);
    checks.clear(); setCatalog(value); select(choice, value); setSaved(value.warning ?? '连接已保存');
    if (choice) update(workspace => ({ ...workspace, model: { provider: choice.provider, id: choice.id } }));
    window.dispatchEvent(new Event('suo-models-changed'));
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError(''); setSaved('');
    const recordId = draftId ?? crypto.randomUUID(); setDraftId(recordId);
    try { accept(await request<ModelCatalog>('models.configure', { draftId: recordId, editModelId, provider, baseUrl: baseUrl.trim(), modelId: modelId.trim(), apiKey: apiKey.trim(), api, supportsImages, network: publicRoute ? network : 'default' })); }
    catch (error) { setError(message(error, '连接保存失败。')); try { setCatalog(await request<ModelCatalog>('models.list')); } catch { /* Keep the form when the local bridge is unavailable. */ } }
    finally { setSaving(false); }
  }
  // Tests the saved record, not unsaved edits in the form.
  const canCheck = !!provider && !!editModelId && !draftId && !targetChanged && modelId.trim() === editModelId;
  async function check() {
    const key = `${provider}/${editModelId}`;
    setChecking(true); setError(''); setSaved('');
    try {
      const result = await request<Check>('models.check', { provider, id: editModelId });
      checks.set(key, result);
      if (!result.ok) setError(result.message ?? '连接测试失败。');
      else if (!result.tools) setError('能对话，但这个模型不支持工具调用：整理画布、撰写文档和联网搜索都用不了。建议换一个支持工具调用的模型。');
      else setSaved(`连接正常，支持画布、文档和联网等工具（${((result.ms ?? 0) / 1000).toFixed(1)} 秒）`);
    } catch (error) { setError(message(error, '连接测试失败。')); }
    finally { setChecking(false); }
  }
  async function importConfig() {
    setSaving(true); setError('');
    try { const value = await chooseModelConfig(); if (value) accept(value); }
    catch (error) { setError(message(error, '配置导入失败，请检查文件格式。')); }
    finally { setSaving(false); }
  }
  const locked = saving || busy;
  return <section className="model-settings" aria-label="模型连接设置">
    <div className="model-settings-status"><strong>模型连接</strong><button type="button" className="chip" onClick={() => select()} disabled={locked}>添加模型</button></div>
    {!!catalog?.models.length && <div className="model-records"><p className="quiet">已添加的模型 · 点击修改配置</p><div className="connected-models">{catalog.models.map(item => <button type="button" className={!draftId && provider === item.provider && editModelId === item.id ? 'active' : ''} key={item.provider + item.id} onClick={() => select(item)} disabled={locked}><strong>{item.name}</strong><small className={checks.get(`${item.provider}/${item.id}`)?.ok === false ? 'failed' : ''}>{checkLabel(checks.get(`${item.provider}/${item.id}`))}</small></button>)}</div></div>}
    {!!catalog?.drafts?.length && <div className="model-records"><p className="quiet">未完成的配置 · 可继续修改</p><div className="connected-models">{catalog.drafts.map(item => <button type="button" className={draftId === item.id ? 'active' : ''} key={item.id} onClick={() => selectDraft(item)} disabled={locked}><strong>{item.modelId || '未命名模型'}</strong><small>待检查</small></button>)}</div></div>}
    {!adding && <p className="quiet">{draftId ? '正在修改配置草稿。' : '正在修改已有记录；同一接口下的模型共用地址和密钥。'}</p>}
    <form autoComplete="off" onSubmit={event => void save(event)}>
      {adding && <div className="model-presets-field"><span className="model-field-label">服务商</span>
        <div className="model-presets" role="radiogroup" aria-label="服务商">
          {[...PRESETS, { id: 'custom', name: '自定义' }].map(item => <button type="button" key={item.id} role="radio" aria-checked={preset === item.id} className={preset === item.id ? 'active' : ''} onClick={() => pickPreset(item.id)} disabled={locked}>{item.name}</button>)}
        </div></div>}
      {service && <p className="quiet model-service-note"><span>{service.name} · {service.baseUrl}</span><button type="button" className="model-link" onClick={() => void openExternal(service.keyUrl).catch(error => setError(message(error, '没能打开网页。')))}>获取 API Key ↗</button></p>}
      {(!adding || !service) && <>
        <label>接口类型<select value={api} onChange={event => { if (event.target.value !== api) setKey(''); setApi(event.target.value); resetList(); }} disabled={locked}>
          <option value="openai-completions">OpenAI 兼容</option><option value="openai-responses">OpenAI Responses</option><option value="anthropic-messages">Anthropic</option>
        </select></label>
        <label>接口地址<input value={baseUrl} onChange={event => { if (target(event.target.value, api) !== target(baseUrl, api)) setKey(''); setUrl(event.target.value); resetList(); }} placeholder="https://api.example.com/v1" autoComplete="off" maxLength={2000} required disabled={locked} /></label>
      </>}
      <div className="model-settings-fields">
        <label>API Key<input type="password" value={apiKey} onChange={event => { setKey(event.target.value); resetList(); }} onBlur={() => { if (apiKey.trim() && !models.length) void discover(); }} placeholder={!targetChanged && (provider || draftHasKey) ? '已保存，留空保留原密钥' : '粘贴 API Key'} autoComplete="off" autoCorrect="off" spellCheck={false} data-1p-ignore data-lpignore="true" data-bwignore="true" maxLength={4096} disabled={locked} /></label>
        <label>模型{models.length && !manual
          ? <select value={models.includes(modelId) ? modelId : ''} onChange={event => { if (event.target.value === '\u0000manual') setManual(true); else setModel(event.target.value); }} disabled={locked}>
              {!models.includes(modelId) && <option value="" disabled>{modelId ? `${modelId}（不在列表里，请重新选择）` : '请选择型号'}</option>}
              {models.map(id => <option key={id} value={id}>{id}</option>)}
              <option value={'\u0000manual'}>手动输入其他型号…</option>
            </select>
          : <input value={modelId} onChange={event => setModel(event.target.value)} placeholder={manual ? '输入型号名称' : '填好 Key 后自动读取'} autoComplete="off" maxLength={240} required disabled={locked} />}</label>
      </div>
      <p className="quiet model-list-note"><span role="status">{listing ? '正在读取可用型号…' : listNote}</span>
        {manual && models.length ? <button type="button" className="model-link" onClick={() => setManual(false)} disabled={locked}>改回从列表选择</button>
          : <button type="button" className="model-link" onClick={() => void discover()} disabled={locked || listing}>{models.length ? '重新读取型号' : '读取可用型号'}</button>}</p>
      {targetChanged && <p className="quiet">接口地址或类型已改变，请填写新接口的 API Key。</p>}
      <label className="model-network-option"><input type="checkbox" checked={supportsImages} onChange={event => setImages(event.target.checked)} disabled={locked} /><span>图片分析（需接口和模型支持）</span></label>
      {publicRoute && <label className="model-network-option"><input type="checkbox" checked={network === 'funnel-public'} onChange={event => { setNetwork(event.target.checked ? 'funnel-public' : 'default'); resetList(); }} disabled={locked} /><span>通过公网连接</span></label>}
      {error && <p className="model-setting-error" role="alert">{error}</p>}
      {saved && <p role="status" className="quiet">{saved}</p>}
      <div className="model-settings-buttons">{native && <button type="button" className="chip" onClick={() => void importConfig()} disabled={locked || checking}>导入 models.json</button>}
        {canCheck && <button type="button" className="chip" title="发一条很短的测试消息，会用掉极少量额度" onClick={() => void check()} disabled={locked || checking}>{checking ? '正在测试…' : '测试连接'}</button>}
        <button type="submit" className="accent-button" disabled={locked || checking}>{saving ? '正在保存…' : provider || draftId ? '保存修改' : '保存连接'}</button></div>
    </form>
  </section>;
}
