import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import FloatingPanel, { usePanelRect } from './FloatingPanel';
import { closeDrawing } from './actions';
import Icon from './Icon';
import { app } from './state';

const DrawingArea = lazy(() => import('./DrawingArea'));
export default function DrawingPanel() {
  const rect = usePanelRect('drawing');
  const id = app.use(state => state.workspace?.id);
  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  const [closing, setClosing] = useState(false);
  const busy = useRef(false);
  const close = useCallback(async () => {
    if (busy.current) return;
    busy.current = true; setClosing(true);
    try { await closeDrawing(); } finally { busy.current = false; setClosing(false); }
  }, []);
  useEffect(() => {
    let press: { x: number; y: number; dragged: boolean } | null = null, frame = 0;
    const down = (event: PointerEvent) => { press = event.button === 0 ? { x: event.clientX, y: event.clientY, dragged: false } : null; };
    const move = (event: PointerEvent) => { if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 5) press.dragged = true; };
    const outside = (event: MouseEvent) => {
      const start = press; press = null;
      if (event.button !== 0 || !start || start.dragged || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
      const target = event.target;
      if (!(target instanceof Element) || (!target.closest('.workspace-surface') && !target.matches('.stage'))) return;
      if (target.closest('[data-panel],button,input,textarea,select,a,[contenteditable],.react-flow__handle,.react-flow__resize-control')) return;
      // Close after focus changes so the last text edit is committed before saving.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { if (app.get().workspace?.id === id && app.get().drawingOpen) void close(); });
    };
    const cancel = () => { press = null; };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointercancel', cancel, true);
    document.addEventListener('click', outside, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointercancel', cancel, true);
      document.removeEventListener('click', outside, true);
    };
  }, [id, close]);
  return <FloatingPanel name="drawing" label="草图编辑器" rect={rect} className="drawing-panel"
    onAnimationComplete={() => api.current?.refresh()}>
    <header className="drawing-head">
      <div><Icon name="pencil" size={17} /><strong>草图</strong></div>
      <button type="button" className="icon-button" disabled={closing} onClick={() => void close()} aria-label="收起草图" title="收起草图"><Icon name="minus" size={18} /></button>
    </header>
    <Suspense fallback={<div className="drawing-body drawing-loading" role="status">正在打开草图…</div>}>
      <DrawingArea key={id} onReady={value => { api.current = value; }} />
    </Suspense>
  </FloatingPanel>;
}
