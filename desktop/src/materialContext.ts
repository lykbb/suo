import { request } from './bridge';
import { extractPdfText } from './pdfText.mjs';
import type { Asset } from './types';

export type Material = { title: string; content: string; image?: { data: string; mimeType: string }; note?: string };
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
// Imported files never change, so a PDF referred to again reuses its text instead of re-parsing.
const pdfTexts = new Map<string, { text: string; pages: number; truncated: boolean }>();
async function pdfText(asset: Asset, signal: AbortSignal) {
  const cached = pdfTexts.get(asset.id);
  if (cached) return cached;
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const base = new URL(`${import.meta.env.BASE_URL}pdf-assets/`, window.location.href).href;
  const blob = await bytes(asset, signal);
  const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), cMapUrl: base + 'cmaps/', cMapPacked: true, standardFontDataUrl: base + 'standard_fonts/', wasmUrl: base + 'wasm/' });
  const abort = () => { void task.destroy(); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    const extracted = await extractPdfText(await task.promise, { signal, maxChars: 400000 });
    pdfTexts.set(asset.id, extracted);
    if (pdfTexts.size > 8) pdfTexts.delete(pdfTexts.keys().next().value!);
    return extracted;
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && error.name === 'PasswordException') throw new Error('这份 PDF 已加密，请提供解密后的副本。');
    throw error;
  } finally { signal.removeEventListener('abort', abort); await task.destroy(); }
}
async function bytes(asset: Asset, signal: AbortSignal): Promise<Blob> {
  if (asset.size > MAX_SOURCE_BYTES) throw new Error(`“${asset.name}”超过 20 MB，请先拆分或压缩后分析。`);
  signal.throwIfAborted();
  if (asset.base64) return new Blob([Uint8Array.from(atob(asset.base64), char => char.charCodeAt(0))], { type: asset.mime });
  if (!asset.sourceUrl || !/^(blob:|suo-file:|https?:\/\/suo-file\.localhost\/)/u.test(asset.sourceUrl)) throw new Error('无法读取这份本地资料，请重新导入。');
  const result = await fetch(asset.sourceUrl, { signal });
  if (!result.ok) throw new Error('本地资料读取失败。');
  const blob = await result.blob();
  if (blob.size > MAX_SOURCE_BYTES) throw new Error('资料超过 20 MB，请先拆分后分析。');
  return blob;
}
async function imageContent(asset: Asset, signal: AbortSignal) {
  const blob = await bytes(asset, signal);
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(blob); }
  catch { signal.throwIfAborted(); throw new Error(`“${asset.name}”无法解码，请换一份有效的 PNG、JPEG 或 WebP 图片。`); }
  try {
    signal.throwIfAborted();
    const ratio = Math.min(1, 1536 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('图片处理失败。');
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let value = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
    if (value.length > 2 * 1024 * 1024 * 4 / 3) value = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
    if (value.length > 2 * 1024 * 1024 * 4 / 3) throw new Error('图片压缩后仍超过 2 MB，请先压缩后分析。');
    signal.throwIfAborted();
    return { data: value, mimeType: 'image/jpeg' };
  } finally { bitmap.close(); }
}
export async function prepareMaterial(card: {title: string; content: string; asset?: Asset}, signal: AbortSignal): Promise<Material> {
  signal.throwIfAborted();
  const title = card.title.slice(0, 240);
  if (!card.asset) return { title, content: card.content.slice(0, 20000), ...(card.content.length > 20000 ? { note: '部分正文已截取，可继续读取后续内容' } : {}) };
  const asset = await request<Asset>('asset.get', { id: card.asset.id });
  signal.throwIfAborted();
  if (asset.error) throw new Error(asset.error);
  if (asset.kind === 'spreadsheet') return { title, content: (asset.text ?? '').slice(0, 20000), note: `XLSX 已读取 ${asset.spreadsheet?.sheets.length ?? 0} 个工作表${asset.truncated || (asset.text?.length ?? 0) > 20000 ? '，部分内容已截取' : ''}；公式仅使用已有缓存结果` };
  if (['text', 'html', 'word'].includes(asset.kind)) {
    let content = asset.text ?? asset.preview ?? '';
    if (asset.kind === 'html') content = new DOMParser().parseFromString(content, 'text/html').body.textContent ?? '';
    return { title, content: content.slice(0, 20000), ...(content.length > 20000 || asset.truncated ? { note: '部分正文已截取' } : {}) };
  }
  if (asset.kind === 'pdf') {
    const extracted = await pdfText(asset, signal), cut = extracted.truncated || extracted.text.length > 20000;
    return { title, content: extracted.text.slice(0, 20000) + (cut ? '\n[正文已截取，其他页面尚未发送]' : ''), note: `PDF 已读取 ${extracted.pages} 页${cut ? '，正文有截取' : ''}` };
  }
  if (asset.kind === 'image') return { title, content: '已附上实际图片内容。', image: await imageContent(asset, signal), note: '图片已作为视觉内容发送' };
  throw new Error(`“${asset.name}”暂不支持内容分析。请提供文字、XLSX、PDF 或图片资料。`);
}

// ---- Reading for the assistant's tools: the whole text in pieces, and keyword search across cards.
type Readable = { title: string; content: string; asset?: Asset };
async function fullText(card: Readable, signal: AbortSignal): Promise<{ text: string; note: string }> {
  if (!card.asset) return { text: card.content, note: '' };
  const asset = await request<Asset>('asset.get', { id: card.asset.id });
  signal.throwIfAborted();
  if (asset.error) throw new Error(asset.error);
  if (asset.kind === 'spreadsheet') return { text: asset.text ?? '', note: `XLSX 已读取 ${asset.spreadsheet?.sheets.length ?? 0} 个工作表${asset.truncated ? '，部分行列或工作表超出读取范围' : ''}；公式仅使用已有缓存结果` };
  if (asset.kind === 'pdf') { const extracted = await pdfText(asset, signal); return { text: extracted.text, note: `PDF 共 ${extracted.pages} 页${extracted.truncated ? '，后面的页面未能读取' : ''}` }; }
  if (!['text', 'html', 'word'].includes(asset.kind)) throw new Error(`“${asset.name}”没有可读取的文字。`);
  let text = asset.text ?? asset.preview ?? '';
  if (asset.kind === 'html') text = new DOMParser().parseFromString(text, 'text/html').body.textContent ?? '';
  return { text, note: asset.truncated ? '文件较大，只读取了前一部分' : '' };
}

const PIECE = 12000;
export async function readMaterial(card: Readable, offset: number, signal: AbortSignal, images: boolean) {
  const title = card.title.slice(0, 240);
  if (card.asset?.kind === 'image') {
    if (!images) return { title, text: '这是一张图片。当前模型没有开启图片分析，无法查看内容。', note: '' };
    const asset = await request<Asset>('asset.get', { id: card.asset.id });
    return { title, text: '已附上图片。', note: '', image: await imageContent(asset, signal) };
  }
  const { text, note } = await fullText(card, signal), start = Math.max(0, Math.floor(offset) || 0), end = Math.min(text.length, start + PIECE);
  return { title, text: text.slice(start, end) || '（没有更多内容）', note: [note, text.length > PIECE ? `第 ${start + 1}–${end} 字，共 ${text.length} 字` : ''].filter(Boolean).join('，'), next: end < text.length ? end : undefined };
}

// Plain keyword search: each card scores by how many query words it contains and how often.
export async function searchMaterials(cards: (Readable & { id: string })[], query: string, signal: AbortSignal, offset = 0) {
  const words = [...new Set(query.toLowerCase().split(/[\s,，。、;；:：]+/u).filter(Boolean))].slice(0, 8);
  if (!words.length) throw new Error('请给出要搜索的关键词。');
  const hits: { id: string; title: string; snippet: string; where: string; score: number }[] = [];
  const failed: { id: string; title: string; reason: string }[] = [];
  const partial: { id: string; title: string; note: string }[] = [];
  for (const card of cards) {
    signal.throwIfAborted();
    let text: string;
    try {
      if (card.asset && !['text', 'html', 'word', 'pdf', 'spreadsheet'].includes(card.asset.kind) && !/\.xlsx?$/iu.test(card.asset.name)) {
        text = '';
        failed.push({ id: card.id, title: card.title, reason: '这份资料没有可搜索的文字，当前只搜索了标题。' });
      } else {
        const content = await fullText(card, signal);
        text = content.text;
        if (content.note && /部分|未能|前一部分/u.test(content.note)) partial.push({ id: card.id, title: card.title, note: content.note });
      }
    } catch (error) { signal.throwIfAborted(); failed.push({ id: card.id, title: card.title, reason: error instanceof Error ? error.message : '正文读取失败。' }); continue; }
    const haystack = `${card.title}\n${text}`, lower = haystack.toLowerCase();
    const counts = words.map(word => lower.split(word).length - 1), found = counts.filter(Boolean).length;
    if (!found) continue;
    const at = Math.max(0, lower.indexOf(words[counts.findIndex(Boolean)]));
    const page = [...haystack.slice(0, at).matchAll(/\[第 (\d+) 页\]/gu)].at(-1)?.[1];
    const sheet = [...haystack.slice(0, at).matchAll(/\[工作表：([^\]\n]+)\]/gu)].at(-1)?.[1], row = [...haystack.slice(0, at).matchAll(/\[第 (\d+) 行\]/gu)].at(-1)?.[1];
    hits.push({ id: card.id, title: card.title, where: sheet ? `工作表「${sheet}」${row ? `，第 ${row} 行` : ''}` : page ? `第 ${page} 页` : '', score: found * 100 + counts.reduce((sum, count) => sum + Math.min(count, 20), 0),
      snippet: haystack.slice(Math.max(0, at - 60), at + 100).replace(/\s+/gu, ' ').trim() });
  }
  const start = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
  const ranked = hits.sort((a, b) => b.score - a.score), end = Math.min(ranked.length, start + 10);
  return { hits: ranked.slice(start, end).map(({ score: _score, ...hit }) => hit), skipped: failed.length, failed, partial,
    scanned: cards.length, scopeCount: cards.length, total: ranked.length, offset: start, ...(end < ranked.length ? { next: end } : {}) };
}

