import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import Icon from './Icon';
GlobalWorkerOptions.workerSrc = workerUrl;
const assetsUrl = new URL(`${import.meta.env.BASE_URL}pdf-assets/`, window.location.href).href;
type PageSize = { width: number; height: number };

function PdfPage({ pdf, number, width, fallback, visible, textMode }: {
  pdf: PDFDocumentProxy; number: number; width: number; fallback: PageSize;
  visible: boolean; textMode: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState(fallback);
  const [text, setText] = useState<string | null>(null), [error, setError] = useState('');
  useEffect(() => {
    if (!visible) return;
    let cancelled = false, render: RenderTask | undefined;
    setError(''); setText(null);
    (async () => {
      const page = await pdf.getPage(number);
      if (cancelled) return;
      const original = page.getViewport({ scale: 1 });
      setSize({ width: original.width, height: original.height });
      if (textMode) {
        const content = await page.getTextContent();
        if (!cancelled) setText(content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim());
        return;
      }
      const element = canvas.current;
      if (!element) return;
      const view = page.getViewport({ scale: Math.min(2, width / original.width) });
      const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(4000000 / (view.width * view.height)));
      element.width = Math.ceil(view.width * ratio); element.height = Math.ceil(view.height * ratio);
      element.style.width = `${view.width}px`; element.style.height = `${view.height}px`;
      render = page.render({ canvas: element, viewport: view, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      await render.promise;
    })().catch(reason => { if (!cancelled && reason.name !== 'RenderingCancelledException') setError('这一页未能读取，请尝试查看正文。'); });
    return () => { cancelled = true; render?.cancel(); };
  }, [pdf, number, visible, width, textMode]);
  const height = Math.ceil(size.height * Math.min(2, width / size.width));
  return <section className={`pdf-page ${textMode ? 'pdf-text-page' : ''}`} data-pdf-page={number}
    aria-label={`PDF 第 ${number} 页`} style={{ minHeight: textMode ? Math.min(height, 900) : height }}>
    {!visible ? <div className="pdf-page-placeholder" aria-hidden="true" />
      : error ? <p className="reader-message" role="status">{error}</p>
      : textMode ? <pre className="card-text">{text === null ? '正在读取…' : text || '本页没有可提取的文字。'}</pre>
      : <canvas key={`${number}-${width}`} ref={canvas} className="pdf-canvas" aria-label={`PDF 第 ${number} 页`} />}
    <span className="pdf-page-number" aria-hidden="true">{number}</span>
  </section>;
}

export default function PdfReader({ url, base64 }: { url?: string; base64?: string }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null), [page, setPage] = useState(1);
  const [fallback, setFallback] = useState<PageSize>({ width: 595, height: 842 });
  const [textMode, setTextMode] = useState(false), [error, setError] = useState('');
  const [password, setPassword] = useState(''), [needsPassword, setNeedsPassword] = useState(false), [passwordInput, setPasswordInput] = useState('');
  const viewport = useRef<HTMLDivElement>(null), [width, setWidth] = useState(300);
  const modePage = useRef<number | null>(null);
  const [range, setRange] = useState<[number, number]>([1, 1]);
  const pages = useMemo(() => Array.from({ length: pdf?.numPages ?? 0 }, (_, index) => index + 1), [pdf]);
  useEffect(() => {
    let cancelled = false;
    setError(''); setPdf(null); setNeedsPassword(false);
    const task = getDocument({ ...(url ? { url, rangeChunkSize: 262144 } : { data: Uint8Array.from(atob(base64 ?? ''), char => char.charCodeAt(0)) }), password: password || undefined,
      cMapUrl: `${assetsUrl}cmaps/`, cMapPacked: true, standardFontDataUrl: `${assetsUrl}standard_fonts/`, wasmUrl: `${assetsUrl}wasm/`,
      enableXfa: false, useWasm: false, maxImageSize: 16000000 });
    task.promise.then(async value => {
      const first = await value.getPage(1), size = first.getViewport({ scale: 1 });
      if (!cancelled) { setFallback({ width: size.width, height: size.height }); setPdf(value); setPage(1); }
    }).catch(reason => {
      if (cancelled) return;
      if (reason.name === 'PasswordException') { setNeedsPassword(true); setError(password ? '密码不正确，请重试。' : ''); }
      else setError('这份 PDF 无法打开，请检查文件是否完整。');
    });
    return () => { cancelled = true; void task.destroy().catch(() => {}); };
  }, [url, base64, password]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(100, Math.round(entries[0].contentRect.width))));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = viewport.current;
    if (!element || !pdf) return;
    let frame = 0;
    const currentPage = () => {
      frame = 0;
      const nodes = element.querySelectorAll<HTMLElement>('[data-pdf-page]');
      if (!nodes.length) return;
      const indexAt = (offset: number) => {
        let low = 0, high = nodes.length - 1;
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          if (nodes[middle].offsetTop <= offset) low = middle; else high = middle - 1;
        }
        return low;
      };
      setPage(Number(nodes[indexAt(element.scrollTop + Math.min(120, element.clientHeight / 4))].dataset.pdfPage));
      const first = indexAt(element.scrollTop - 700) + 1;
      const last = indexAt(element.scrollTop + element.clientHeight + 700) + 1;
      setRange(previous => previous[0] === first && previous[1] === last ? previous : [first, last]);
    };
    const scroll = () => { if (!frame) frame = requestAnimationFrame(currentPage); };
    element.addEventListener('scroll', scroll, { passive: true }); currentPage();
    return () => { element.removeEventListener('scroll', scroll); cancelAnimationFrame(frame); };
  }, [pdf, width, textMode]);
  function jump(number: number) {
    const element = viewport.current, target = element?.querySelector<HTMLElement>(`[data-pdf-page="${number}"]`);
    if (!element || !target) return;
    element.scrollTo({ top: Math.max(0, target.offsetTop - 4), behavior: 'auto' }); setPage(number);
  }
  useLayoutEffect(() => {
    if (modePage.current === null) return;
    const number = modePage.current; modePage.current = null;
    jump(number);
  }, [textMode]);
  return <div className="pdf-reader">
    {pdf && <div className="reader-toolbar">
      <button type="button" aria-label="上一页" disabled={page <= 1} onClick={() => jump(page - 1)}><Icon name="chevron" size={14} style={{ transform: 'rotate(180deg)' }} /></button>
      <span aria-live="polite">{page} / {pdf.numPages}</span>
      <button type="button" aria-label="下一页" disabled={page >= pdf.numPages} onClick={() => jump(page + 1)}><Icon name="chevron" size={14} /></button>
      <button type="button" className="reader-view" aria-pressed={textMode} onClick={() => { modePage.current = page; setTextMode(value => !value); }}>{textMode ? '页面' : '正文'}</button>
    </div>}
    <div ref={viewport} className="pdf-viewport nodrag nopan nowheel" aria-label="PDF 连续阅读" tabIndex={0}>
      {needsPassword ? <form className="reader-password" onSubmit={event => { event.preventDefault(); setPassword(passwordInput); }}>
        <label>PDF 密码<input type="password" autoComplete="off" value={passwordInput} onChange={event => setPasswordInput(event.target.value)} /></label><button type="submit">打开</button>
      </form> : !pdf ? <p className="reader-message">{error || '正在打开 PDF…'}</p>
        : pages.map(number => <PdfPage key={`${pdf.fingerprints[0]}-${number}`} pdf={pdf} number={number} width={width} fallback={fallback} visible={number >= range[0] && number <= range[1]} textMode={textMode} />)}
      {needsPassword && error && <p className="reader-message" role="status">{error}</p>}
    </div>
  </div>;
}
