import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import { native, request } from './bridge';
import { fileKind } from '../bridge/formats.mjs';
import type { Asset } from './types';
import './CardContent.css';
import HtmlReader from './HtmlReader';
import type { ReaderActivation } from './readerMessage';
import CsvReader from './CsvReader';
import SpreadsheetReader from './SpreadsheetReader';
import { editableMarkdown } from './editableMarkdown';
import { sourceClick, sourceDoubleClick, sourcePointerDown } from './sourceLinkEvents';
import './SourceLinks.css';
import { clearTextSelection } from './selection';
export { safeHtml } from './htmlPreview';
const PdfReader = lazy(() => import('./PdfReader'));
const cache = new Map<string, Asset>(), pending = new Map<string, Promise<Asset>>();
let cacheBytes = 0;
const assetBytes = (asset: Asset) => 512 + (asset.text?.length ?? 0) * 2 + (asset.base64?.length ?? 0) * 2 + (asset.spreadsheet ? JSON.stringify(asset.spreadsheet).length * 2 : 0);
function loadAsset(id: string) {
  const cached = cache.get(id);
  if (cached) { cache.delete(id); cache.set(id, cached); return Promise.resolve(cached); }
  if (pending.has(id)) return pending.get(id)!;
  const job = request<Asset>('asset.get', { id }).then(asset => {
    cache.set(id, asset); cacheBytes += assetBytes(asset);
    while (cacheBytes > 40 * 1024 * 1024 && cache.size > 1) {
      const oldest = cache.keys().next().value!;
      const previous = cache.get(oldest)!; cacheBytes -= assetBytes(previous); cache.delete(oldest);
    }
    return asset;
  }).finally(() => pending.delete(id));
  pending.set(id, job); return job;
}
export const DocumentText = memo(function DocumentText({ text, markdown = false, compact = false, editable = false, onActivate, onOpen }: { text: string; markdown?: boolean; compact?: boolean; editable?: boolean; onActivate?: (event: ReaderActivation) => void; onOpen?: () => void }) {
  const html = useMemo(() => markdown && !editable ? marked.parse(text, { async: false, breaks: true, gfm: true }) : '', [text, markdown, editable]);
  const documentHtml = useMemo(() => editable && markdown ? editableMarkdown(text) : '', [text, markdown, editable]);
  if (editable && markdown) return <div className="card-markdown nodrag nopan nowheel" onClick={sourceClick} onPointerDown={sourcePointerDown} onDoubleClick={event => { if (sourceDoubleClick(event)) return; event.preventDefault(); event.stopPropagation(); clearTextSelection(); onOpen?.(); }} dangerouslySetInnerHTML={{ __html: documentHtml }} />;
  return markdown ? <HtmlReader text={html} markdown title="Markdown 正文" compact={compact} onActivate={onActivate} onOpen={onOpen} />
    : <pre className="card-text nodrag nopan nowheel">{text}</pre>;
});
export default memo(function Preview({ asset, compact = false, onActivate, onOpen, onImageSize }: { asset: Asset; compact?: boolean; onActivate?: (event: ReaderActivation) => void; onOpen?: () => void; onImageSize?: (width: number, height: number) => void }) {
  const holder = useRef<HTMLDivElement>(null), [visible, setVisible] = useState(!compact);
  const [loaded, setLoaded] = useState<Asset>(() => ({ ...asset, ...fileKind(asset.name) })), [error, setError] = useState('');
  useEffect(() => {
    if (visible || !holder.current) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '300px' });
    observer.observe(holder.current); return () => observer.disconnect();
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    loadAsset(asset.id).then(value => { if (!cancelled) { setLoaded(value); setError(''); } }).catch(reason => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, [asset.id, visible]);
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    setUrl(loaded.sourceUrl);
    if (loaded.sourceUrl || !loaded.base64 || loaded.kind === 'pdf') return;
    const bytes = Uint8Array.from(atob(loaded.base64), char => char.charCodeAt(0));
    const next = URL.createObjectURL(new Blob([bytes], { type: loaded.mime }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [loaded.sourceUrl, loaded.base64, loaded.mime, loaded.kind]);
  let body;
  if (error || loaded.error) body = <p className="reader-message" role="status">{error || loaded.error}</p>;
  else if (!visible) body = <p className="reader-message">正在读取…</p>;
  else if (loaded.mime === 'text/csv' || /\.csv$/i.test(loaded.name)) body = <CsvReader text={loaded.text ?? loaded.preview ?? ''} truncated={loaded.truncated} />;
  else if (loaded.kind === 'spreadsheet') body = loaded.spreadsheet ? <SpreadsheetReader book={loaded.spreadsheet} compact={compact} /> : <p className="reader-message">正在读取工作表…</p>;
  else if (loaded.kind === 'text') body = <DocumentText text={loaded.text ?? loaded.preview ?? '正在读取…'} markdown={/\.(md|markdown)$/i.test(loaded.name)} compact={compact} onActivate={onActivate} onOpen={onOpen} />;
  else if (loaded.kind === 'word') body = loaded.text !== undefined ? <DocumentText text={loaded.text} /> : <p className="reader-message">{native ? '正在读取 Word 正文…' : 'Word 正文请在 Mac 桌面版阅读。'}</p>;
  else if (loaded.kind === 'html') body = <HtmlReader text={loaded.text ?? loaded.preview ?? ''} title={loaded.name} compact={compact} onActivate={onActivate} onOpen={onOpen} />;
  else if (loaded.kind === 'image') body = url ? <img className="card-media" src={url} alt={loaded.name} draggable={false} onLoad={event => onImageSize?.(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} /> : <p className="reader-message">正在读取图片…</p>;
  else if (loaded.kind === 'pdf') body = (loaded.sourceUrl || loaded.base64) ? <Suspense fallback={<p className="reader-message">正在打开 PDF…</p>}><PdfReader url={loaded.sourceUrl} base64={loaded.base64} /></Suspense> : <p className="reader-message">正在读取 PDF…</p>;
  else if (loaded.kind === 'video' || loaded.kind === 'audio') body = url ? <div className="card-media-shell">{loaded.kind === 'video'
    ? <video className="card-media" src={url} controls preload="metadata" playsInline onError={() => setError('当前视频编码无法播放，请使用 MP4（H.264）或兼容的视频文件。')} />
    : <audio src={url} controls preload="metadata" onError={() => setError('当前音频编码无法播放。')} />}</div> : <p className="reader-message">正在读取媒体…</p>;
  else body = <p className="reader-message">暂不支持此格式的正文预览。<br />{loaded.name} · {Math.max(1, Math.round(loaded.size / 1024))} KB</p>;
  return <div ref={holder} tabIndex={compact ? undefined : 0} className={`card-reader ${compact && loaded.kind === 'image' ? '' : 'nodrag nopan nowheel'} ${compact ? 'compact' : ''}`} onDoubleClick={event => {
    event.stopPropagation();
    if (compact && !(event.target as Element).closest('a,button,input,textarea,video,audio')) { event.preventDefault(); clearTextSelection(); onOpen?.(); }
  }}>
    {body}{loaded.truncated && loaded.mime !== 'text/csv' && loaded.kind !== 'spreadsheet' && <p className="reader-limit">当前显示前 {loaded.kind === 'html' ? '400' : '100'} 万字符，原文件完整保留。</p>}
  </div>;
});
