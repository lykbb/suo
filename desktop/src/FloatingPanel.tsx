import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { motion } from 'motion/react';
import Icon from './Icon';
import { focusPanel, panelChange, pinPanel } from './actions';
import { clampRect, movePanel, panelDefaults, resizePanel, toolbarRect, welcomeComposer, type ResizeEdge } from './geometry';
import { panelZ } from './layers';
import { panelSpring } from './motion';
import { app, hasThreadOf, isWelcomeOf } from './state';
import type { PanelName, Rect } from './types';
import { clearContentSelection, clearTextSelection, selectablePanelContent, suppressTextSelection } from './selection';
import './FloatingPanel.css';

export function usePanelRect(name: PanelName) {
  const stage = app.use(state => state.stage), hasThread = app.use(hasThreadOf);
  const custom = app.use(state => state.workspace?.panels[name]);
  const welcome = app.use(state => name === 'composer' && isWelcomeOf(state));
  return useMemo(() => {
    const rect = welcome ? welcomeComposer(stage.width, stage.height) : custom ?? panelDefaults(stage.width, stage.height, hasThread)[name];
    return name === 'toolbar' ? toolbarRect(rect, stage.width, stage.height) : clampRect(rect, stage.width, stage.height);
  }, [welcome, custom, stage, hasThread, name]);
}

const interactive = 'button,input,textarea,select,a,label,video,audio,canvas,iframe,[contenteditable],[data-panel-interactive],.message,.thread-empty,.card-reader,.context-label';
const edges: ResizeEdge[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
const directions = { n: '上边', ne: '右上角', e: '右边', se: '右下角', s: '下边', sw: '左下角', w: '左边', nw: '左上角' };
export default function FloatingPanel({ name, label, rect, children, className = '', enterFrom, onAnimationComplete }: {
  name: PanelName; label: string; rect: Rect; children: ReactNode; className?: string; enterFrom?: 'right' | 'left'; onAnimationComplete?: () => void;
}) {
  const stage = app.use(state => state.stage), layers = app.use(state => state.workspace?.panelLayers);
  const locked = app.use(state => name === 'composer' && isWelcomeOf(state));
  const pinnable = name === 'reader' || name === 'drawing';
  const gesture = useRef<{ rect: Rect; next: Rect; x: number; y: number; edge?: ResizeEdge; id: string; pointer: number } | null>(null);
  const selectionLock = useRef<(() => void) | null>(null);
  const textPress = useRef<{ pointer: number; x: number; y: number; moved: boolean; region: Element; pendingFocus: boolean } | null>(null);
  const frame = useRef(0);
  const [live, setLive] = useState<Rect | null>(null), [active, setActive] = useState(false);
  const cancel = useRef(() => {});
  cancel.current = () => {
    cancelAnimationFrame(frame.current); frame.current = 0;
    selectionLock.current?.(); selectionLock.current = null;
    gesture.current = null; setLive(null); setActive(false);
  };
  useEffect(() => {
    const key = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape' && gesture.current) { event.preventDefault(); cancel.current(); } };
    const track = (event: globalThis.PointerEvent) => {
      const press = textPress.current;
      if (press?.pointer === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 3) press.moved = true;
    };
    const focus = (event: globalThis.PointerEvent) => {
      const press = textPress.current;
      if (press?.pointer === event.pointerId && press.pendingFocus) { press.pendingFocus = false; focusPanel(name); }
    };
    document.addEventListener('keydown', key);
    document.addEventListener('pointermove', track, true);
    document.addEventListener('pointerup', focus, true);
    const blur = () => { textPress.current = null; if (gesture.current) cancel.current(); };
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('keydown', key); document.removeEventListener('pointermove', track, true); document.removeEventListener('pointerup', focus, true);
      window.removeEventListener('blur', blur); cancelAnimationFrame(frame.current); selectionLock.current?.();
    };
  }, [name]);
  function begin(event: PointerEvent<HTMLElement>, edge?: ResizeEdge) {
    if (locked || event.button !== 0 || !app.get().workspace) return;
    event.preventDefault(); event.stopPropagation();
    selectionLock.current?.(); selectionLock.current = suppressTextSelection();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { rect: { ...rect }, next: { ...rect }, x: event.clientX, y: event.clientY, edge, id: app.get().workspace!.id, pointer: event.pointerId };
    setActive(true);
  }
  function move(event: PointerEvent<HTMLElement>) {
    const start = gesture.current;
    if (!start || start.pointer !== event.pointerId) return;
    if (!(event.buttons & 1) || app.get().workspace?.id !== start.id) { cancel.current(); return; }
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (Math.hypot(dx, dy) < 3 && !live) return;
    start.next = start.edge ? resizePanel(start.rect, dx, dy, stage.width, stage.height, start.edge, name)
      : movePanel(start.rect, dx, dy, stage.width, stage.height, false, name);
    if (!frame.current) frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      if (gesture.current === start) setLive(start.next);
    });
  }
  function end() {
    const start = gesture.current;
    if (!start) return;
    cancelAnimationFrame(frame.current); frame.current = 0;
    gesture.current = null;
    selectionLock.current?.(); selectionLock.current = null;
    if (app.get().workspace?.id === start.id && Object.keys(start.rect).some(key => start.rect[key as keyof Rect] !== start.next[key as keyof Rect])) panelChange(name, start.next);
    setLive(null); setActive(false);
  }
  function key(event: KeyboardEvent<HTMLButtonElement>, edge: ResizeEdge) {
    if (locked) return;
    event.stopPropagation();
    const step = event.shiftKey ? 1 : 10;
    const keys: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (!keys[event.key]) return;
    event.preventDefault();
    const [dx, dy] = keys[event.key];
    panelChange(name, resizePanel(rect, dx, dy, stage.width, stage.height, edge, name));
  }
  const shown = live ?? rect;
  const pinned = pinnable && !!layers?.[name]?.pinned, offset = enterFrom === 'right' ? 32 : enterFrom === 'left' ? -24 : 0;
  return <motion.section className={`floating-panel ${className} ${locked ? 'panel-fixed' : ''} ${active ? 'panel-moving' : ''} ${pinned ? 'panel-pinned' : ''}`} aria-label={label}
    data-panel={name} style={{ left: 0, top: 0, zIndex: panelZ(layers, name) }}
    onPointerDownCapture={event => {
      textPress.current = null;
      const region = selectablePanelContent(event.target as Element);
      if (!locked && region && event.button === 0 && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
        // Keep layer updates outside the native text-selection start. A click clears the old range;
        // a real drag then creates its own range without preventDefault or pointer capture.
        clearTextSelection();
        textPress.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, moved: false, region, pendingFocus: true };
      } else if (!locked) focusPanel(name);
      if (!locked && !(event.target as Element).closest(interactive)) begin(event);
    }} onClickCapture={event => {
      const press = textPress.current;
      if (press && !press.moved && event.detail === 1 && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) clearContentSelection(press.region);
    }} onPointerMove={move} onPointerUp={end} onPointerCancel={() => { textPress.current = null; cancel.current(); }} onLostPointerCapture={end}
    initial={enterFrom ? { opacity: 0, x: rect.x + offset, y: rect.y, width: rect.width, height: rect.height } : false}
    animate={{ opacity: 1, x: shown.x, y: shown.y, width: shown.width, height: shown.height }}
    exit={enterFrom ? { opacity: 0, x: shown.x + offset, transition: { duration: 0.18 } } : undefined}
    transition={active ? { duration: 0 } : panelSpring} onAnimationComplete={onAnimationComplete}>
    {!locked && pinnable && <div className="panel-controls">
      <button type="button" className={`panel-pin ${pinned ? 'active' : ''}`} aria-label={`${pinned ? '取消' : ''}置顶${label}`} title={pinned ? '取消置顶' : '置顶'} aria-pressed={pinned} onClick={() => pinPanel(name)}><Icon name="pin" size={14} /></button>
    </div>}
    {children}
    {!locked && name !== 'toolbar' && edges.map(edge => <button key={edge} type="button" className={`panel-edge panel-edge-${edge}`} data-resize-edge={edge} aria-label={`从${directions[edge]}调整${label}大小`}
      onPointerDown={event => begin(event, edge)} onKeyDown={event => key(event, edge)} />)}
  </motion.section>;
}
