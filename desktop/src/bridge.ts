import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Asset, BridgeEvent, ModelCatalog, Workspace } from './types';
import { loadBrowserAsset, localFileError, storeBrowserAsset, removeBrowserAssets } from './browserStorage';
import { fileKind, MAX_FILE_BYTES, MAX_TEXT_CHARS, MAX_HTML_CHARS, MAX_TEXT_BYTES, MAX_HTML_BYTES, FILE_LIMIT_MESSAGE } from '../bridge/formats.mjs';
import { assertSaveRequest, committedReplay, committedState, workspaceAssetIds } from '../bridge/saveReceipt.mjs';

export const native = isTauri();
// The desktop host rejects with plain text; turn it into an Error so the interface shows the actual
// reason instead of a generic one.
async function call<T>(command: string, args?: Record<string, unknown>) {
  try { return await invoke<T>(command, args); }
  catch (error) { throw error instanceof Error ? error : new Error(String(error || '操作失败，请重试。')); }
}
export async function openExternal(url: string) {
  if (url.length > 8192 || /[\u0000-\u001f\u007f]/u.test(url)) throw new Error('来源网址格式不正确。');
  let value: URL;
  try { value = new URL(url); } catch { throw new Error('来源网址格式不正确。'); }
  if (!['http:', 'https:'].includes(value.protocol) || value.username || value.password) throw new Error('只支持打开不含账号密码的网页来源。');
  if (native) await call('open_external', { url: value.href });
  else window.open(value.href, '_blank', 'noopener,noreferrer');
}
const prefix = 'suo-desktop-preview:';
const subscribers = new Set<(event: BridgeEvent) => void>();
let eventSource: EventSource | undefined;
let eventReady: Promise<void> | undefined;
function localToken() {
  const token = document.querySelector<HTMLMetaElement>('meta[name="suo-local-api"]')?.content;
  if (!token) throw new Error('请用开发服务或桌面客户端连接模型。');
  return token;
}
function ensureEvents() {
  if (eventReady) return eventReady;
  const source = new EventSource('/__suo/events?token=' + encodeURIComponent(localToken()));
  eventSource = source;
  source.onmessage = event => { try { emit(JSON.parse(event.data)); } catch {} };
  eventReady = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { source.close(); eventSource = undefined; eventReady = undefined; reject(new Error('本地模型连接超时。')); }, 5000);
    source.onopen = () => { clearTimeout(timer); resolve(); };
    source.onerror = () => {
      clearTimeout(timer); source.close(); eventSource = undefined; eventReady = undefined;
      emit({ event: 'bridge-error', data: { message: '本地模型连接中断，请刷新页面。' } }); reject(new Error('本地模型连接中断。'));
    };
  });
  return eventReady;
}

export async function request<T>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (native) {
    const result = await call<T>('bridge_request', { method, payload });
    if (method === 'asset.get') {
      const asset = result as Asset;
      if (['image', 'pdf', 'video', 'audio'].includes(asset.kind)) asset.sourceUrl = convertFileSrc(asset.id, 'suo-file');
    }
    return result;
  }
  if (['models.list', 'models.configure', 'models.check', 'models.discover', 'prompt.send', 'prompt.abort', 'ui.reply', 'skills.list', 'skills.get', 'skills.parse', 'skills.save', 'templates.list', 'templates.get', 'templates.save'].includes(method)) {
    if (method.startsWith('prompt.')) await ensureEvents();
    const response = await fetch('/__suo/request', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Suo-Token': localToken() }, body: JSON.stringify({ method, payload }) });
    if (!response.ok && response.status !== 400) throw new Error('本地模型连接失败，请刷新页面。');
    const value = await response.json();
    if (value.error) throw new Error(value.error);
    return value.result as T;
  }
  // Serialize workspace mutations across tabs, including attachment cleanup.
  if (method.startsWith('workspace.') && navigator.locks) return navigator.locks.request('suo-preview-workspaces', () => browserRequest<T>(method, payload));
  return browserRequest<T>(method, payload);
}
async function browserRequest<T>(method: string, payload: Record<string, unknown>): Promise<T> {
  switch (method) {
    case 'workspace.list':
    case 'workspace.trash': return Object.keys(localStorage).filter(key => key.startsWith(prefix)).map(key => JSON.parse(localStorage[key])).filter(state => !!state.deletedAt === (method === 'workspace.trash')).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)) as T;
    case 'workspace.create': {
      const state: Workspace = { id: crypto.randomUUID(), title: '新会话', version: 1, updatedAt: new Date().toISOString(), nodes: [], edges: [], messages: [], draft: '', panels: {}, viewport: { x: 0, y: 0, zoom: 1 } };
      localStorage.setItem(prefix + state.id, JSON.stringify(state)); return state as T;
    }
    case 'workspace.purge': {
      const items = payload.items as {id: string; version: number}[];
      if (!Array.isArray(items) || !items.length || items.length > 2000 || new Set(items.map(item => item.id)).size !== items.length) throw new Error('请先选择回收站会话。');
      const removed = items.map(item => { const value = JSON.parse(localStorage.getItem(prefix + item.id) ?? 'null') as Workspace | null; if (!value?.deletedAt || value.version !== item.version) throw new Error('回收站内容已变化，请重新确认。'); return value; });
      const ids = new Set(removed.flatMap(workspaceAssetIds));
      const selected = new Set(items.map(item => item.id));
      const remaining = Object.keys(localStorage).filter(key => key.startsWith(prefix) && !selected.has(key.slice(prefix.length))).map(key => JSON.parse(localStorage[key]) as Workspace);
      const shared = new Set(remaining.flatMap(workspaceAssetIds));
      const unused = [...ids].filter(id => !shared.has(id));
      for (const item of items) localStorage.removeItem(prefix + item.id);
      if (!navigator.locks) return { sessionsMoved: items.length, assetsMoved: 0, warning: '此浏览器不能锁定多个窗口，附件暂时保留。' } as T;
      try { await removeBrowserAssets(unused); return { sessionsMoved: items.length, assetsMoved: unused.length } as T; }
      catch { return { sessionsMoved: items.length, assetsMoved: 0, warning: '会话已移除，附件整理未完成。' } as T; }
    }
    case 'workspace.load': { const state = JSON.parse(localStorage.getItem(prefix + payload.id) ?? 'null'); return (state?.deletedAt ? null : state) as T; }
    case 'workspace.remove':
    case 'workspace.restore': {
      const current = JSON.parse(localStorage.getItem(prefix + payload.id) ?? 'null');
      if (!current || !!current.deletedAt !== (method === 'workspace.restore')) throw new Error('会话不存在或状态已变化。');
      if (current.version !== payload.expectedVersion) throw new Error('会话已被另一个窗口更新。');
      const next = committedState({ ...current, deletedAt: method === 'workspace.remove' ? new Date().toISOString() : undefined }, current.version + 1, undefined, current.version);
      localStorage.setItem(prefix + current.id, JSON.stringify(next)); return next as T;
    }
    case 'workspace.save': {
      const state = payload.state as Workspace;
      const current = JSON.parse(localStorage.getItem(prefix + state.id) ?? 'null');
      assertSaveRequest(payload.requestId, payload.expectedVersion);
      if (current?.deletedAt || state.deletedAt !== current?.deletedAt) throw new Error('会话已删除，请先从回收站恢复。');
      if (committedReplay(current, state, payload.expectedVersion, payload.requestId)) return current as T;
      if ((current?.version ?? 0) !== payload.expectedVersion) {
        console.warn('Suo workspace save conflict '+JSON.stringify({ expected: payload.expectedVersion, stored: current?.version ?? 0 }));
        throw new Error('会话已被另一个窗口更新。');
      }
      const next = committedState(state, Number(payload.expectedVersion) + 1, payload.requestId, payload.expectedVersion);
      localStorage.setItem(prefix + state.id, JSON.stringify(next)); return next as T;
    }
    case 'asset.get': return await loadBrowserAsset(String(payload.id)) as T;
    default: throw new Error('浏览器预览不支持这个操作。');
  }
}
function emit(event: BridgeEvent) { subscribers.forEach(callback => callback(event)); }
export async function events(callback: (event: BridgeEvent) => void) {
  if (native) return listen<BridgeEvent>('bridge-event', event => callback(event.payload));
  subscribers.add(callback);
  if (import.meta.env.DEV) void ensureEvents().catch(() => {});
  return () => { subscribers.delete(callback); if (!subscribers.size) { eventSource?.close(); eventSource = undefined; eventReady = undefined; } };
}
export async function onNativeFiles(callback: (assets: Asset[]) => void) {
  if (!native) return () => {};
  return listen<Asset[]>('native-files', event => callback(event.payload));
}
export async function onNativeImportStart(callback: () => void) {
  if (!native) return () => {};
  return listen('native-import-start', callback);
}
export async function onNativeClose(callback: () => void) {
  if (!native) return () => {};
  return listen('native-close', callback);
}
export async function finishClose() { if (native) await call('finish_close'); }
export async function chooseFiles() { return native ? call<Asset[]>('choose_files') : []; }
export async function chooseModelConfig() { return native ? call<ModelCatalog | null>('choose_model_config') : null; }
// Exports a document: a save dialog in the desktop App, a download in the browser preview.
export async function saveText(name: string, text: string) {
  if (native) return call<boolean>('save_text', { name, text });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  return true;
}
// Web search and page reading run in a hidden window of the desktop App (see src-tauri/src/browser.rs).
type Found = { engine: string; results: { title: string; url: string; snippet: string }[] };
export async function browserSearch(query: string, engine: string) {
  if (!native) throw new Error('联网搜索需要在桌面 App 中使用。');
  return call<Found>('browser_search', { query, engine });
}
export async function browserRead(url: string) {
  if (!native) throw new Error('浏览器读取需要在桌面 App 中使用。');
  return call<{ title: string; url: string; text: string }>('browser_read', { url });
}
export async function browserFiles(files: File[]): Promise<Asset[]> {
  if (files.length > 20) throw new Error('一次最多导入 20 份资料，请分批添加。');
  const result: Asset[] = [];
  // Keep media as local Blob URLs; sequential text reads bound transient memory.
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) { result.push({ id: '', name: file.name, size: file.size, ...fileKind(file.name), error: FILE_LIMIT_MESSAGE }); continue; }
    const { kind, mime } = fileKind(file.name);
    const asset: Asset = { id: crypto.randomUUID(), name: file.name, size: file.size, mime, kind };
    if (kind === 'text' || kind === 'html') {
      const html = kind === 'html', byteLimit = html ? MAX_HTML_BYTES : MAX_TEXT_BYTES, charLimit = html ? MAX_HTML_CHARS : MAX_TEXT_CHARS;
      const text = await file.slice(0, byteLimit).text();
      asset.text = text.slice(0, charLimit);
      asset.preview = text.slice(0, 100000);
      asset.truncated = text.length > charLimit || file.size > byteLimit;
    } else if (['image', 'pdf', 'video', 'audio'].includes(kind)) asset.sourceUrl = URL.createObjectURL(file);
    try {
      await storeBrowserAsset(asset, file);
      // Spreadsheet parsing is lazy: retain the original and open it through asset.get.
      result.push(asset);
    } catch (error) {
      if (asset.sourceUrl) URL.revokeObjectURL(asset.sourceUrl);
      result.push({ ...asset, id: '', sourceUrl: undefined, error: localFileError(error) });
    }
  }
  return result;
}
