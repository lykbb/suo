import type { Asset } from './types';
import { fileKind } from '../bridge/formats.mjs';
import { readBrowserXlsx } from './spreadsheetBrowser.mjs';
import { spreadsheetText, SPREADSHEET_LIMITS, XLS_MESSAGE } from '../bridge/spreadsheet.mjs';

type StoredAsset = { asset: Asset; blob: Blob };
let opening: Promise<IDBDatabase> | undefined;
const active = new Map<string, Asset>();

function database() {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('suo-local-files', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'asset.id' });
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); opening = undefined; };
      resolve(db);
    };
    request.onerror = () => { opening = undefined; reject(request.error); };
    request.onblocked = () => { opening = undefined; reject(new Error('本地资料库正在更新，请关闭其他 Suo 标签页后重试。')); };
  });
  return opening;
}

export async function storeBrowserAsset(asset: Asset, blob: Blob) {
  const db = await database();
  const { sourceUrl: _temporaryUrl, ...saved } = asset;
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('files', 'readwrite');
    transaction.objectStore('files').put({ asset: saved, blob } satisfies StoredAsset);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('本地资料保存失败。'));
    transaction.onerror = () => reject(transaction.error);
  });
  active.set(asset.id, asset);
}

export async function loadBrowserAsset(id: string): Promise<Asset> {
  const cached = active.get(id);
  if (cached && (fileKind(cached.name).kind !== 'spreadsheet' || cached.kind === 'spreadsheet' && (cached.spreadsheet || cached.error))) return cached;
  const db = await database();
  const record = await new Promise<StoredAsset | undefined>((resolve, reject) => {
    const request = db.transaction('files', 'readonly').objectStore('files').get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  if (!record) throw new Error('这份旧资料的正文没有保存在本机，请重新导入。新导入的资料会自动保存。');
  // Older imports may be binary: classify the saved name and parse the retained Blob.
  const asset = { ...record.asset, ...fileKind(record.asset.name) };
  if (asset.kind === 'spreadsheet' && !asset.spreadsheet && !asset.error) {
    if (/\.xls$/iu.test(asset.name)) asset.error = XLS_MESSAGE;
    else if (record.blob.size > SPREADSHEET_LIMITS.bytes) asset.error = 'XLSX 正文读取上限 20 MB，请拆分后导入。';
    else {
      try { asset.spreadsheet = await readBrowserXlsx(await record.blob.arrayBuffer()); Object.assign(asset, spreadsheetText(asset.spreadsheet)); }
      catch (error) { asset.error = error instanceof Error ? error.message : '无法读取这份 XLSX，请另存为 .xlsx 后重试。'; }
    }
  }
  if (['image', 'pdf', 'video', 'audio'].includes(asset.kind)) asset.sourceUrl = URL.createObjectURL(record.blob);
  active.set(id, asset);
  return asset;
}

export function localFileError(error: unknown) {
  return error instanceof DOMException && error.name === 'QuotaExceededError'
    ? '本机浏览器存储空间不足，资料未导入。请释放空间，或使用桌面版导入。'
    : '资料未能保存到本机，请重试或使用桌面版导入。';
}

export async function removeBrowserAssets(ids: string[]) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('files', 'readwrite');
    for (const id of ids) transaction.objectStore('files').delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('附件清理未完成。'));
  });
  for (const id of ids) { const asset = active.get(id); if (asset?.sourceUrl) URL.revokeObjectURL(asset.sourceUrl); active.delete(id); }
}
