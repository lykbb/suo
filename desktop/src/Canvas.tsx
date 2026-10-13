import { useEffect, useMemo, useRef, useState } from 'react';
import { Background, BackgroundVariant, BaseEdge, ConnectionMode, getSmoothStepPath, MarkerType, Position, ReactFlow, SelectionMode, useInternalNode, ViewportPortal, type Edge, type EdgeProps, type InternalNode } from '@xyflow/react';
import { AnimatePresence, motion } from 'motion/react';
import { CardNode, GroupNode } from './CardNode';
import { closeTransient, connect, finishNodeDrag, labelEdge, onEdgesChange, onNodesChange, openCreateMenu, record, saveViewport, zoomCanvasAt } from './actions';
import { connectionSides, lowerLabelEdges, RELATIONS, type Side } from './cardLinks';
import { orderCards } from './layers';
import { wheelPixels } from './readerMessage';
import { spring } from './motion';
import { app } from './state';
import { preferences } from './preferences';
import { clearTextSelection, EDITABLE, suppressTextSelection } from './selection';

const nodeTypes = { card: CardNode, group: GroupNode };
const EMPTY: never[] = [];
// Every connection points somewhere; its relation, when written, sits on the line.
const ARROW = { type: MarkerType.ArrowClosed, width: 14, height: 14, color: 'var(--edge)' };
// Reverse labels sharing the same port pair are separated without shifting unrelated routes.
const withArrows = (edges: Edge[]) => {
  const lower = lowerLabelEdges(edges);
  return edges.map(edge => ({ ...edge, type: 'floating', markerEnd: edge.markerEnd ?? ARROW, labelBgPadding: [6, 3] as [number, number], labelBgBorderRadius: 6,
    data: { ...edge.data, lower: lower.has(edge.id) } }));
};

// Keep the ports chosen by a manual gesture; unassigned edges retain automatic routing.
const SIDES: Record<Side, Position> = { left: Position.Left, right: Position.Right, top: Position.Top, bottom: Position.Bottom };
const boxOf = (node: InternalNode) => ({ ...node.internals.positionAbsolute, width: node.measured.width ?? 0, height: node.measured.height ?? 0 });
function FloatingEdge({ id, source, target, sourceHandleId, targetHandleId, data, markerEnd, style, label, labelStyle, labelShowBg, labelBgStyle, labelBgPadding, labelBgBorderRadius, interactionWidth }: EdgeProps) {
  const from = useInternalNode(source), to = useInternalNode(target);
  if (!from || !to || source === target) return null;
  const sides = connectionSides(boxOf(from), boxOf(to), sourceHandleId, targetHandleId);
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX: sides.start.x, sourceY: sides.start.y, sourcePosition: SIDES[sides.from], targetX: sides.end.x, targetY: sides.end.y, targetPosition: SIDES[sides.to], borderRadius: 8 });
  return <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} label={label} labelX={labelX} labelY={labelY + (data?.lower ? 24 : 0)} labelStyle={labelStyle} labelShowBg={labelShowBg}
    labelBgStyle={labelBgStyle} labelBgPadding={labelBgPadding} labelBgBorderRadius={labelBgBorderRadius} interactionWidth={interactionWidth} />;
}
const edgeTypes = { floating: FloatingEdge };

// While a line is being drawn, cards stop lifting under the pointer (repainting their shadows made
// the drag stutter), every dot shows, and the card the line would join is outlined.
function connecting(surface: HTMLElement | null, nodeId: string | null) {
  surface?.classList.toggle('connecting', !!nodeId);
  surface?.querySelectorAll('.connect-from').forEach(node => node.classList.remove('connect-from'));
  if (nodeId) surface?.querySelector(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`)?.classList.add('connect-from');
}

// Thin lines where the dragged card lines up with the cards beside it.
function AlignmentGuides() {
  const guides = app.use(state => state.guides);
  return <ViewportPortal>{guides.map(guide => <div key={`${guide.axis}${guide.at}`} className={`alignment-guide ${guide.axis}`}
    style={guide.axis === 'x' ? { left: guide.at, top: guide.from, height: guide.to - guide.from } : { top: guide.at, left: guide.from, width: guide.to - guide.from }} />)}</ViewportPortal>;
}

// Double-clicking a connection asks what it means: one of the usual relations or a few words.
function EdgeLabelEditor() {
  const editor = app.use(state => state.edgeEditor);
  const current = app.use(state => state.workspace?.edges.find(edge => edge.id === state.edgeEditor?.id)?.label);
  const [text, setText] = useState('');
  useEffect(() => { setText(typeof current === 'string' ? current : ''); }, [editor?.id]);
  if (!editor) return null;
  return <form className="edge-label-editor" style={{ left: editor.x, top: editor.y }} onSubmit={event => { event.preventDefault(); labelEdge(editor.id, text); }}
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); app.set({ edgeEditor: null }); } }}>
    <div className="edge-relations">{RELATIONS.map(relation => <button type="button" key={relation} className={text === relation ? 'active' : ''} onClick={() => labelEdge(editor.id, relation)}>{relation}</button>)}</div>
    <input autoFocus value={text} maxLength={40} placeholder="或写下这条线的含义，回车保存" onChange={event => setText(event.target.value)} />
  </form>;
}

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
  const shownEdges = useMemo(() => withArrows(edges), [edges]);
  const tool = app.use(state => state.tool);
  const background = preferences.use(state => state.background);
  const drawingOpen = app.use(state => state.drawingOpen);
  const viewport = useMemo(() => app.get().workspace?.viewport ?? { x: 0, y: 0, zoom: 1 }, [id]);
  return <div ref={holder} className="workspace-surface" onMouseDownCapture={event => { if (event.detail > 1 && (event.target as Element).classList.contains('react-flow__pane')) { event.preventDefault(); clearTextSelection(); } }}
    onDoubleClick={event => { if ((event.target as HTMLElement).classList.contains('react-flow__pane')) { event.preventDefault(); clearTextSelection(); openCreateMenu(event); } }}>
    <ReactFlow key={id} proOptions={{ hideAttribution: true }} nodes={layered} elevateNodesOnSelect={false} edges={shownEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
      onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={connect} isValidConnection={connection => connection.source !== connection.target}
      connectionMode={ConnectionMode.Loose} connectionRadius={32} onConnectStart={(_, { nodeId }) => connecting(holder.current, nodeId)}
      onConnectEnd={(event, state) => {
        connecting(holder.current, null);
        if (state.isValid || !state.fromNode) return;
        // Let go over a card rather than one of its dots: it connects all the same.
        const point = 'changedTouches' in event ? event.changedTouches[0] : event;
        const id = document.elementFromPoint(point.clientX, point.clientY)?.closest('.react-flow__node-card')?.getAttribute('data-id');
        if (id) connect({ source: state.fromNode.id, target: id, sourceHandle: null, targetHandle: null });
      }}
      onEdgeDoubleClick={(event, edge) => { event.stopPropagation(); app.set({ edgeEditor: { id: edge.id, x: event.clientX, y: event.clientY } }); }}
      onNodeDragStart={() => record()} onNodeDragStop={finishNodeDrag}
      onMoveStart={() => { movementLock.current ??= suppressTextSelection(); }}
      onMoveEnd={(_, value) => { saveViewport(value); movementLock.current?.(); movementLock.current = null; }} defaultViewport={viewport}
      minZoom={0.2} maxZoom={2.5} zoomOnDoubleClick={false}
      panOnDrag={tool === 'pan' ? true : [1, 2]} selectionOnDrag={tool !== 'pan'} selectionMode={SelectionMode.Partial} panOnScroll zoomOnScroll={false} zoomOnPinch
      onPaneClick={() => { closeTransient(); app.set({ edgeEditor: null }); }} onPaneContextMenu={event => { event.preventDefault(); openCreateMenu(event); }}
      deleteKeyCode={drawingOpen ? null : ['Backspace', 'Delete']} multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
      connectionLineStyle={{ stroke: '#a8957f', strokeWidth: 1.5 }}>
      {background !== 'plain' && <Background variant={background === 'grid' ? BackgroundVariant.Lines : BackgroundVariant.Dots} gap={22} size={1.2} color="var(--line-strong)" />}
      <Presence />
      <AlignmentGuides />
      <EdgeLabelEditor />
    </ReactFlow>
  </div>;
}
