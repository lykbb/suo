import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { closeReader, selectAllCards, zoomCanvasAt } from './actions';
import { app, isWelcomeOf } from './state';
import { selectAllScope, clearTextSelection, syncReaderSelection } from './selection';
import { safeHtml } from './htmlPreview';
import { openExternal } from './bridge';
import { validReaderMessage, wheelPixels, type ReaderActivation } from './readerMessage';

export default memo(function HtmlReader({ text, title, markdown = false, compact = false, onActivate, onOpen }: {
  text: string; title: string; markdown?: boolean; compact?: boolean; onActivate?: (event: ReaderActivation) => void; onOpen?: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [channel] = useState(() => crypto.randomUUID());
  const activate = useRef(onActivate); activate.current = onActivate;
  const open = useRef(onOpen); open.current = onOpen;
  const html = useMemo(() => safeHtml(text, markdown, { channel, scriptUrl: new URL('/reader-events.js', window.location.href).href, compact }), [text, markdown, channel, compact]);
  useEffect(() => {
    const message = (event: MessageEvent) => {
      const element = frame.current;
      if (!element || event.source !== element.contentWindow || !validReaderMessage(event.data, channel)) return;
      const data = event.data;
      if (data.type === 'reader-external-link') void openExternal(data.url).catch(error => app.set({ toast: error instanceof Error ? error.message : '来源页面未能打开，请重试。' }));
      else if (data.type === 'reader-close') closeReader();
      else if (data.type === 'reader-select-all' && compact) {
        const state = app.get();
        if (selectAllScope(null, { home: isWelcomeOf(state), blocked: !!state.popup || !!state.menu || state.sessionManaging, drawingOpen: state.drawingOpen, readerOpen: !!state.preview || state.sketchPreview }) === 'cards') { clearTextSelection(); selectAllCards(); }
      }
      else if (data.type === 'reader-open' && compact) open.current?.();
      else if (data.type === 'reader-activate' && compact) { closeReader(); activate.current?.(data); }
      else if (data.type === 'reader-zoom' && compact) {
        const box = element.getBoundingClientRect();
        const sx = box.width / Math.max(1, element.clientWidth), sy = box.height / Math.max(1, element.clientHeight);
        zoomCanvasAt(box.left + data.x * sx, box.top + data.y * sy, wheelPixels(data.delta, data.deltaMode, element.clientHeight));
      }
    };
    window.addEventListener('message', message);
    return () => window.removeEventListener('message', message);
  }, [compact, channel]);
  return <iframe ref={frame} data-reader-channel={channel} onLoad={() => { if (frame.current) syncReaderSelection(frame.current); }} className="card-html nodrag nopan nowheel" title={title} sandbox="allow-scripts" srcDoc={html} />;
});
