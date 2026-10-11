import './drawingSetup';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Excalidraw, MainMenu } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { bindDrawingCommit, update } from './actions';
import { app } from './state';
import type { DrawingState } from './types';

const KEEP = ['viewBackgroundColor', 'scrollX', 'scrollY', 'zoom', 'currentItemStrokeColor', 'currentItemBackgroundColor', 'currentItemFillStyle', 'currentItemStrokeWidth', 'currentItemStrokeStyle', 'currentItemRoughness', 'currentItemOpacity', 'currentItemFontFamily', 'currentItemFontSize', 'currentItemTextAlign', 'currentItemRoundness', 'gridSize'] as const;

export default function DrawingArea({ onReady }: { onReady: (api: ExcalidrawImperativeAPI) => void }) {
  const id = app.use(state => state.workspace?.id);
  const [initialData] = useState(() => app.get().workspace?.drawing ?? { elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {} });
  const pending = useRef<DrawingState | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorApi = useRef<ExcalidrawImperativeAPI | null>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      const target = event.target;
      if (event.button !== 0 || !(target instanceof Element)) return;
      const inside = target.closest('.drawing-panel');
      const canvas = inside && target.matches('canvas');
      const heading = inside && target.closest('.drawing-head') && !target.closest('button');
      if (inside && !canvas && !heading) return;
      if (!inside && target.closest('[role="dialog"],.popover,.dropdown-menu,.color-picker')) return;
      const api = editorApi.current, state = api?.getAppState();
      // Embedded narrow editors use Excalidraw's mobile UI, which does not dismiss on canvas clicks.
      if (state?.openMenu || state?.openPopup) api?.updateScene({ appState: { openMenu: null, openPopup: null } });
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, []);
  const lastSaved = useRef(JSON.stringify(initialData));
  const commit = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (!pending.current || app.get().workspace?.id !== id) return;
    const text = JSON.stringify(pending.current);
    if (text === lastSaved.current) return;
    const drawing = JSON.parse(text) as DrawingState;
    update(state => ({ ...state, drawing }));
    lastSaved.current = text;
  }, [id]);
  useEffect(() => {
    const off = bindDrawingCommit(commit);
    return () => { commit(); off(); };
  }, [commit]);
  function change(elements: readonly ExcalidrawElement[], state: AppState, files: BinaryFiles) {
    pending.current = { elements, appState: Object.fromEntries(KEEP.map(key => [key, state[key]])), files };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(commit, 450);
  }
  return <div className="drawing-body" data-panel-interactive>
      <Excalidraw initialData={initialData} onChange={change} excalidrawAPI={api => { editorApi.current = api; onReady(api); }} handleKeyboardGlobally={false} detectScroll langCode="zh-CN" theme="light" name="Suo 草图" UIOptions={{ canvasActions: { saveToActiveFile: false, toggleTheme: false } }}>
        <MainMenu>
          <MainMenu.DefaultItems.LoadScene />
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.Export />
          <MainMenu.DefaultItems.ClearCanvas />
        </MainMenu>
      </Excalidraw>
  </div>;
}
