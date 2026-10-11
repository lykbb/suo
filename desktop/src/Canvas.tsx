import { useEffect, useMemo, useRef } from 'react';
import { Background, BackgroundVariant, ReactFlow, SelectionMode, ViewportPortal } from '@xyflow/react';
import { AnimatePresence, motion } from 'motion/react';
import { CardNode, GroupNode } from './CardNode';
import { closeTransient, connect, finishNodeDrag, onEdgesChange, onNodesChange, openCreateMenu, record, saveViewport, zoomCanvasAt } from './actions';
import { orderCards } from './layers';
import { wheelPixels } from './readerMessage';
import { spring } from './motion';
import { app } from './state';
import { preferences } from './preferences';
import { clearTextSelection, EDITABLE, suppressTextSelection } from './selection';

const nodeTypes = { card: CardNode, group: GroupNode };
const EMPTY: never[] = [];

// Suo's presence: a small cursor that lands where it just worked, then fades.
function Presence() {
  const presence = app.use(state => state.presence);
  return <ViewportPortal>
    <AnimatePresence>{presence && <motion.div key={presence.key} className="presence" style={{ left: presence.x, top: presence.y }}
      initial={{ opacity: 0, scale: 0.8, x: -14, y: -10 }} animate={{ opacity: 1, scale: 1, x: 0, y: 0 }} exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.2 } }} transition={spring}>
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3l14 8-6 2-2 6z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
      <span>{presence.label}</span>
    </motion.div>}</AnimatePresence>
  </ViewportPortal>;
}

export default function Canvas() {
  const holder = useRef<HTMLDivElement>(null);
  const movementLock = useRef<(() => void) | null>(null);
  useEffect(() => {
    const element = holder.current;
    let pointerLock: (() => void) | null = null, wheelLock: (() => void) | null = null, wheelTimer = 0;
    const endPointer = () => { pointerLock?.(); pointerLock = null; };
    const pointer = (event: PointerEvent) => {
      if ((event.target as Element).closest(EDITABLE)) return;
      endPointer(); pointerLock = suppressTextSelection();
    };
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault(); event.stopPropagation();
      wheelLock ??= suppressTextSelection();
      window.clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(() => { wheelLock?.(); wheelLock = null; }, 160);
      zoomCanvasAt(event.clientX, event.clientY, wheelPixels(event.deltaY, event.deltaMode, element?.clientHeight));
    };
    const endMovement = () => { endPointer(); movementLock.current?.(); movementLock.current = null; wheelLock?.(); wheelLock = null; window.clearTimeout(wheelTimer); };
    element?.addEventListener('pointerdown', pointer, true);
    element?.addEventListener('wheel', wheel, { capture: true, passive: false });
    window.addEventListener('pointerup', endPointer, true);
    window.addEventListener('pointercancel', endPointer, true);
    window.addEventListener('blur', endMovement);
    return () => {
      element?.removeEventListener('pointerdown', pointer, true);
      element?.removeEventListener('wheel', wheel, true);
      window.removeEventListener('pointerup', endPointer, true);
      window.removeEventListener('pointercancel', endPointer, true);
      window.removeEventListener('blur', endMovement); endMovement();
    };
  }, []);
  const id = app.use(state => state.workspace?.id ?? '');
  const nodes = app.use(state => state.workspace?.nodes ?? EMPTY);
  const layered = useMemo(() => orderCards(nodes), [nodes]);
  const edges = app.use(state => state.workspace?.edges ?? EMPTY);
  const tool = app.use(state => state.tool);
  const background = preferences.use(state => state.background);
  const drawingOpen = app.use(state => state.drawingOpen);
  const viewport = useMemo(() => app.get().workspace?.viewport ?? { x: 0, y: 0, zoom: 1 }, [id]);
  return <div ref={holder} className="workspace-surface" onMouseDownCapture={event => { if (event.detail > 1 && (event.target as Element).classList.contains('react-flow__pane')) { event.preventDefault(); clearTextSelection(); } }}
    onDoubleClick={event => { if ((event.target as HTMLElement).classList.contains('react-flow__pane')) { event.preventDefault(); clearTextSelection(); openCreateMenu(event); } }}>
    <ReactFlow key={id} proOptions={{ hideAttribution: true }} nodes={layered} elevateNodesOnSelect={false} edges={edges} nodeTypes={nodeTypes}
      onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={connect}
      onNodeDragStart={() => record()} onNodeDragStop={finishNodeDrag}
      onMoveStart={() => { movementLock.current ??= suppressTextSelection(); }}
      onMoveEnd={(_, value) => { saveViewport(value); movementLock.current?.(); movementLock.current = null; }} defaultViewport={viewport}
      minZoom={0.2} maxZoom={2.5} zoomOnDoubleClick={false}
      panOnDrag={tool === 'pan' ? true : [1, 2]} selectionOnDrag={tool !== 'pan'} selectionMode={SelectionMode.Partial} panOnScroll zoomOnScroll={false} zoomOnPinch
      onPaneClick={closeTransient} onPaneContextMenu={event => { event.preventDefault(); openCreateMenu(event); }}
      deleteKeyCode={drawingOpen ? null : ['Backspace', 'Delete']} multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
      connectionLineStyle={{ stroke: '#a8957f', strokeWidth: 1.5 }}>
      {background !== 'plain' && <Background variant={background === 'grid' ? BackgroundVariant.Lines : BackgroundVariant.Dots} gap={22} size={1.2} color="var(--line-strong)" />}
      <Presence />
    </ReactFlow>
  </div>;
}
