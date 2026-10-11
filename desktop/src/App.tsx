import { useCallback, useEffect, useState, type DragEvent } from 'react';
import { useReactFlow } from '@xyflow/react';
import { AnimatePresence } from 'motion/react';
import { native, events, onNativeClose, onNativeFiles, onNativeImportStart } from './bridge';
import { addCard, bindFileInput, bindFlow, bindStage, closeDrawing, closeReader, toggleGroupSelected, handleNativeClose, beginNativeImport, importNativeAssets, importBrowserFiles, loadInitial, notice, receive, selectAllCards, travelHistory, ungroupSelected } from './actions';
import Canvas from './Canvas';
import { BottomStatus, CreateMenu, DropOverlay, SelectionBar, SessionMenu, Toast, ZoomControls } from './Chrome';
import Modal from './Modal';
import { Composer, OpenThreadButton, ReaderPanel, ThreadPanel, Toolbar } from './Panels';
import TitleBar from './TitleBar';
import Welcome from './Welcome';
import { app, isWelcomeOf } from './state';
import type { Card } from './types';
import { clearTextSelection, keepsNativeMenu, selectAllScope } from './selection';

import DrawingPanel from './DrawingPanel';

function useBridge() {
  useEffect(() => {
    let cancelled = false;
    const unlisteners: (() => void)[] = [];
    const keep = (off: () => void) => { if (cancelled) off(); else unlisteners.push(off); return cancelled; };
    (async () => {
      // A fresh wrapper per subscription: the browser preview keeps listeners in a Set, so reusing
      // `receive` would let the first (discarded) StrictMode run unsubscribe the second.
      if (keep(await events(event => receive(event)))) return;
      if (keep(await onNativeFiles(assets => { void importNativeAssets(assets); }))) return;
      if (keep(await onNativeImportStart(beginNativeImport))) return;
      if (keep(await onNativeClose(() => void handleNativeClose()))) return;
      await loadInitial(() => cancelled);
    })().catch(error => notice(String(error)));
    return () => { cancelled = true; unlisteners.forEach(off => off()); };
  }, []);
}

// The web engine's own right-click menu (Reload, Inspect…) stays out of the App. This runs after the
// canvas has shown its own menu, which already prevents the default one.
function useNativeMenu() {
  useEffect(() => {
    if (!native) return;
    const menu = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null, selection = window.getSelection();
      if (!keepsNativeMenu(target, !!target && !!selection && !selection.isCollapsed && selection.containsNode(target, true))) event.preventDefault();
    };
    document.addEventListener('contextmenu', menu);
    return () => document.removeEventListener('contextmenu', menu);
  }, []);
}

function useShortcuts() {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (app.get().drawingOpen) {
          event.preventDefault();
          if (event.target instanceof HTMLElement && event.target.closest('.drawing-body')) event.target.blur();
          requestAnimationFrame(() => void closeDrawing());
        }
        else { closeReader(); app.set({ menu: null, popup: '', editor: null }); }
        return;
      }
      const targetElement = event.target instanceof Element ? event.target : null;
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'a') {
        const state = app.get();
        const scope = selectAllScope(targetElement, { home: isWelcomeOf(state), blocked: !!state.popup || !!state.menu || state.sessionManaging, drawingOpen: state.drawingOpen, readerOpen: !!state.preview || state.sketchPreview });
        if (scope === 'native') return;
        event.preventDefault(); event.stopPropagation(); clearTextSelection();
        if (scope === 'cards') selectAllCards();
        else if (scope === 'text') {
          const region = targetElement?.closest('.reader-panel')?.querySelector('.card-reader') ?? targetElement?.closest('.message');
          if (region) window.getSelection()?.selectAllChildren(region);
        }
        return;
      }
      if (app.get().sessionManaging || targetElement?.closest('.drawing-body')) return;
      if (targetElement?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),.layout-handle,.layout-resize')) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); travelHistory(event.shiftKey); return; }
      const state = app.get();
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'g' && state.workspace && !isWelcomeOf(state) && !state.popup && !state.editor) {
        event.preventDefault(); event.stopPropagation();
        if (!event.repeat) { if (event.shiftKey) ungroupSelected(); else toggleGroupSelected(); }
        return;
      }
      if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'n' && !state.editor && !state.preview) { event.preventDefault(); addCard('note'); }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, []);
}

function useStageSize(element: HTMLElement | null) {
  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(entries => { const { width, height } = entries[0].contentRect; app.set({ stage: { width, height } }); });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
}

export default function App() {
  const flow = useReactFlow<Card>();
  useEffect(() => bindFlow(flow), [flow]);
  useBridge();
  useShortcuts();
  useNativeMenu();
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const state = app.get();
      if (!state.preview && !state.sketchPreview) return;
      const target = event.target;
      if (target instanceof Element && !target.closest('[data-panel="reader"],.modal-backdrop')) closeReader();
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, []);
  const ready = app.use(state => !!state.workspace);
  const home = app.use(isWelcomeOf);
  const drawingOpen = app.use(state => state.drawingOpen);
  const [stage, setStage] = useState<HTMLElement | null>(null);
  const stageRef = useCallback((element: HTMLElement | null) => { bindStage(element); setStage(element); }, []);
  useStageSize(stage);
  function drop(event: DragEvent) {
    if ((event.target as Element).closest('.drawing-body')) return;
    event.preventDefault();
    app.set({ dragOver: false });
    if (!native) void importBrowserFiles([...event.dataTransfer.files]);
  }
  return <div className={`suo-app ${native ? 'native' : 'browser-preview'} ${home ? 'is-home' : ''}`}>
    <TitleBar />
    <main ref={stageRef} className="stage" inert={app.use(state => state.sessionManaging)}
      onDragOver={event => { if ((event.target as Element).closest('.drawing-body')) return; event.preventDefault(); if (!native && event.dataTransfer.types.includes('Files')) app.set({ dragOver: true }); }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node)) app.set({ dragOver: false }); }}
      onDrop={drop}>
      {ready && <Canvas />}
      <Welcome />
      <AnimatePresence>{ready && !home && <Toolbar key="toolbar" />}</AnimatePresence>
      <ThreadPanel />
      <ReaderPanel />
      <OpenThreadButton />
      <Composer />
      <SelectionBar />
      <BottomStatus />
      <ZoomControls />
      <CreateMenu />
      <DropOverlay />
      {drawingOpen && <DrawingPanel />}
      <Toast />
    </main>
    <SessionMenu />
    <Modal />
    <input ref={bindFileInput} type="file" multiple hidden onChange={async event => { await importBrowserFiles([...event.target.files ?? []]); event.target.value = ''; }} />
  </div>;
}
