/// <reference types="vite/client" />
import { addEdge, applyEdgeChanges, applyNodeChanges, type Connection, type EdgeChange, type NodeChange, type ReactFlowInstance, type Viewport } from '@xyflow/react';
import { browserFiles, chooseFiles, finishClose, native, request, saveText } from './bridge';
import { boardViewport, cleanNodes, freeSpot, groupCards, imageGeometry, openArea, ungroupCards } from './geometry';
import { orderCards, orderPanels } from './layers';
import { withDrawingCard } from './drawingModel';
import { prepareMaterial, type Material } from './materialContext';
import { prepareHistory } from '../bridge/history.mjs';
import { STAGGER, reducedMotion } from './motion';
import { app, hasThreadOf, isWelcomeOf, type Popup } from './state';
import type { Asset, BoardTask, BridgeEvent, Card, CardData, Message, PanelName, Rect, Workspace, WorkspaceSummary } from './types';
import { handleUiRequest } from './agentTools';
import { metadataPatch, type MetadataChange } from './cardMetadata';
import { messageDisplayText } from './messageError.mjs';
import { replyWithSources } from './sourceLinks';
import { addCardsToGroup, captureGroupResize, groupSelectionPlan, reparentDraggedCards, resizeGroupCards, restoreGroupResize, selectedGroupIds, type GroupResizeSnapshot } from './grouping';

export const OUTLINE = '一、背景与问题\n\n二、目标用户\n\n三、关键取舍\n\n四、目标体验\n\n五、专题任务\n\n六、版本安排\n\n七、风险与验证\n\n八、下一步';
type Snapshot = { nodes: Card[]; edges: Workspace['edges']; viewport?: Viewport };
type Run = { workspaceId: string; messageId: string; logicalRequestId?: string; runId?: string; cancelRequested?: boolean; preparing?: AbortController };
type PendingSave = { requestId: string; state: ReturnType<typeof serialize>; expectedVersion: number };
type ImportTarget = { workspaceId: string; point: { x: number; y: number } };
type DraftHistory = { past: string[]; future: string[] };

// Bookkeeping that never drives rendering, kept across dev hot reloads: editing this file while
// the app runs does not reset the saved version and turn the next save into a version conflict.
type Bindings = { flow: ReactFlowInstance<Card> | null; stage: HTMLElement | null; fileInput: HTMLInputElement | null; drawingCommit?: () => void };
const kept = (import.meta.hot?.data ?? {}) as { session?: typeof initialSession; history?: { past: Snapshot[]; future: Snapshot[] }; draftHistory?: Map<string, DraftHistory>; bindings?: Bindings; workspaceLoads?: { revision: number } };
const initialSession = { version: 0, dirty: false, saving: null as Promise<void> | null, pendingSave: null as PendingSave | null, pendingChanged: false, closing: false, importing: false, importCount: 0, running: null as Run | null };
export const session = kept.session ?? initialSession;
const history = kept.history ?? { past: [] as Snapshot[], future: [] as Snapshot[] };
const bindings: Bindings = kept.bindings ?? { flow: null, stage: null, fileInput: null };
const workspaceLoads = kept.workspaceLoads ?? { revision: 0 };
const draftHistory = kept.draftHistory ?? new Map<string, DraftHistory>();
session.pendingSave ??= null; session.pendingChanged ??= false; session.importCount ??= 0;
if (import.meta.hot) Object.assign(import.meta.hot.data, { session, history, draftHistory, bindings, workspaceLoads });

let saveTimer: ReturnType<typeof setTimeout> | undefined;
export const bindFlow = (instance: ReactFlowInstance<Card>) => { bindings.flow = instance; };
export const bindStage = (element: HTMLElement | null) => { bindings.stage = element; };
export const bindFileInput = (element: HTMLInputElement | null) => { bindings.fileInput = element; };

// New cards animate in once, with a stagger; loaded cards do not. Notes open for editing in place.
// A card with `from` starts where something on screen was (the composer, a staged file) and flies
// to its place; the offset is in the card's own units, so it already accounts for the zoom.
export type Flight = { x: number; y: number; scale: number; rotate: number };
export type Entrance = { delay: number; from?: Flight };
const entrances = new Map<string, Entrance>();
export const takeEntrance = (id: string) => { const value = entrances.get(id); entrances.delete(id); return value; };
export const animateIn = (id: string, delay: number) => { entrances.set(id, { delay }); };

export function notice(text: string) { app.set({ toast: text }); }

async function hydrateDraftAttachments(workspace: Workspace) {
  const assets = await Promise.all((workspace.draftAttachments ?? []).map(async asset => {
    try { return await request<Asset>('asset.get', { id: asset.id }); }
    catch { return { ...asset, error: '附件原件暂时无法读取，请重新导入。' }; }
  }));
  return { ...workspace, draftAttachments: assets };
}

export function newCard(data: Partial<CardData>, x: number, y: number): Card {
  return { id: crypto.randomUUID(), type: 'card', position: { x, y }, style: data.asset ? { width: 380, height: data.asset.kind === 'pdf' ? 360 : 280 } : data.kind === 'document' ? { width: 340, height: 260 } : { width: 258 }, data: { title: '新便签', content: '', kind: 'note', source: 'user', ...data } };
}

function serialize(state: Workspace, version: number) {
  const compact = (asset: Asset) => ({ id: asset.id, name: asset.name, size: asset.size, kind: asset.kind, mime: asset.mime, preview: asset.preview });
  return { ...state, version, draftAttachments: (state.draftAttachments ?? []).map(compact), nodes: cleanNodes(state.nodes).map(node => ({ ...node, data: { ...node.data, asset: node.data.asset ? compact(node.data.asset) : undefined } })) };
}

function scheduleSave() { if (app.get().sessionManaging) return; clearTimeout(saveTimer); saveTimer = setTimeout(() => void flush(), 650); }

// persist: false for selection and measurement, which are never saved.
export function update(change: (state: Workspace) => Workspace, { persist = true } = {}) {
  const { workspace } = app.get();
  if (!workspace) return;
  if (!persist) { app.set({ workspace: change(workspace) }); return; }
  let next = change(workspace);
  if (!workspace.nodes.length && !workspace.messages.length && (next.nodes.length || next.messages.length)) {
    const { composer: _homeRect, ...panels } = next.panels;
    next = { ...next, panels };
  }
  session.dirty = true;
  if (session.pendingSave) session.pendingChanged = true;
  app.set({ workspace: next, attachments: next.draftAttachments ?? [], saveStatus: '未保存' });
  scheduleSave();
}

export async function flush() {
  drainNodeChanges();
  bindings.drawingCommit?.();
  clearTimeout(saveTimer);
  if (session.saving) { await session.saving; if (!session.dirty) return; }
  if (!app.get().workspace || (!session.dirty && !session.pendingSave)) return;
  const job = (async () => {
    while ((session.dirty || session.pendingSave) && app.get().workspace) {
      const source = app.get().workspace!, id = source.id;
      if (!session.pendingSave) {
        session.pendingSave = { requestId: crypto.randomUUID(), state: structuredClone(serialize(source, session.version)), expectedVersion: session.version };
        session.pendingChanged = false;
        session.dirty = false;
      }
      const pending = session.pendingSave;
      if (pending.state.id !== id) { notice('原会话的保存尚未确认，请先返回该会话重试。'); break; }
      app.set({ saveStatus: '保存中…' });
      try {
        const saved = await request<Workspace>('workspace.save', pending);
        if (session.pendingSave === pending) { session.pendingSave = null; session.dirty = !!session.pendingChanged; session.pendingChanged = false; }
        if (app.get().workspace?.id === id) { session.version = saved.version; app.set({ saveStatus: session.dirty ? '未保存' : '已保存' }); }
      } catch (error) { session.dirty = true; app.set({ saveStatus: '保存失败' }); notice(String(error)); break; }
    }
  })();
  session.saving = job;
  try { await job; } finally { if (session.saving === job) session.saving = null; }
}

export function record({ includeViewport = false }: { includeViewport?: boolean } = {}) {
  const { workspace } = app.get();
  if (!workspace) return;
  history.past.push(structuredClone({ nodes: workspace.nodes, edges: workspace.edges, ...(includeViewport ? { viewport: bindings.flow?.getViewport() ?? workspace.viewport } : {}) }));
  if (history.past.length > 50) history.past.shift();
  history.future = [];
  app.set(state => ({ historyVersion: state.historyVersion + 1 }));
}

export function travelHistory(redo: boolean) {
  if (groupResizeGesture && !groupResizeGesture.ended) { cancelGroupResize(groupResizeGesture.snapshot.groupId); return; }
  const { workspace } = app.get();
  if (!workspace) return;
  const source = redo ? history.future : history.past, target = redo ? history.past : history.future;
  const snapshot = source.pop();
  if (!snapshot) return;
  target.push(structuredClone({ nodes: workspace.nodes, edges: workspace.edges, ...(snapshot.viewport ? { viewport: bindings.flow?.getViewport() ?? workspace.viewport } : {}) }));
  update(state => ({ ...state, ...snapshot }));
  if (snapshot.viewport && bindings.flow) void bindings.flow.setViewport(snapshot.viewport, { duration: reducedMotion() ? 0 : 200 });
  app.set(state => ({ historyVersion: state.historyVersion + 1 }));
}

export function togglePopup(name: Popup) { app.set(state => ({ popup: state.popup === name ? '' : name })); }
let sessionListRevision = 0;
export async function toggleSessions() {
  const revision = ++sessionListRevision;
  if (app.get().popup === 'sessions') { app.set({ popup: '' }); return; }
  app.set({ popup: 'sessions', menu: null });
  try {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    if (revision !== sessionListRevision || app.get().popup !== 'sessions') return;
    const sessions = await request<WorkspaceSummary[]>('workspace.list');
    if (revision === sessionListRevision && app.get().popup === 'sessions') app.set({ sessions });
  } catch (error) {
    if (revision === sessionListRevision && app.get().popup === 'sessions') notice(String(error));
  }
}
export async function emptySessionTrash(items: WorkspaceSummary[]) {
  if (app.get().sessionManaging || session.importing || app.get().busy) { notice('请先结束当前操作。'); return false; }
  app.set({ sessionManaging: true });
  try {
    await flush(); if (session.dirty) throw new Error('请先完成当前会话保存。');
    const result = await request<{sessionsMoved: number; assetsMoved: number; warning?: string}>('workspace.purge', { items: items.map(item => ({ id: item.id, version: item.version })) });
    app.set({ sessions: await request<WorkspaceSummary[]>('workspace.list') });
    notice(result.warning ?? `已清空 ${result.sessionsMoved} 个会话，整理 ${result.assetsMoved} 份未共享附件。`);
    return true;
  } catch (error) { notice(String(error)); return false; }
  finally { app.set({ sessionManaging: false }); }
}

export function selectAllCards() {
  drainNodeChanges();
  update(state => ({ ...state,
    nodes: state.nodes.map(node => ({ ...node, selected: node.selectable !== false && node.data.kind !== 'group' })),
    edges: state.edges.map(edge => edge.selected ? { ...edge, selected: false } : edge),
  }), { persist: false });
}
export type SessionChange = { title: string } | { pinned: boolean } | { remove: true } | { restore: true; version: number };
export async function manageSession(id: string, change: SessionChange) {
  if (app.get().sessionManaging || session.importing) { notice('请等当前操作结束后再管理会话。'); return false; }
  app.set({ sessionManaging: true });
  const revision = ++workspaceLoads.revision;
  ++sessionListRevision;
  try {
    if (app.get().busy) await stop();
    await flush();
    if (session.dirty) throw new Error('保存还没成功，请先处理保存错误。');
    const current = app.get().workspace;
    if ('restore' in change) {
      await request('workspace.restore', { id, expectedVersion: change.version });
    } else {
      const source = current?.id === id ? serialize(current, session.version) : await request<Workspace | null>('workspace.load', { id });
      if (!source) throw new Error('会话不存在或已删除。');
      if ('remove' in change) {
        await request('workspace.remove', { id, expectedVersion: source.version });
        if (current?.id === id) {
          // Do not keep a deleted record active if the following load fails.
          session.dirty = false;
          history.past = []; history.future = [];
          app.set({ workspace: null, editor: null, preview: null, sketchPreview: false, drawingOpen: false, presence: null, attachments: [], menu: null, saveStatus: '已保存' });
          const list = await request<WorkspaceSummary[]>('workspace.list');
          const recent = [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
          let next = recent ? await request<Workspace>('workspace.load', { id: recent.id }) : await request<Workspace>('workspace.create');
          if (!next) throw new Error('会话未能打开，请点击新会话。');
          next = await hydrateDraftAttachments(next);
          session.version = next.version;
          app.set({ workspace: withDrawingCard({ ...next, nodes: cleanNodes(next.nodes) }), attachments: next.draftAttachments ?? [], threadOpen: true });
        }
      } else {
        const patch = 'title' in change ? { title: change.title.trim(), titleCustomized: true } : change;
        if ('title' in patch && (!patch.title || patch.title.length > 120)) throw new Error('会话名称应为 1 到 120 个字符。');
        if (current?.id === id) {
          update(value => ({ ...value, ...patch }));
          await flush();
          if (session.dirty) throw new Error('会话名称或置顶状态尚未保存成功，请重试。');
        } else await request<Workspace>('workspace.save', { state: { ...source, ...patch }, expectedVersion: source.version });
      }
    }
    const sessions = await request<WorkspaceSummary[]>('workspace.list');
    if (revision === workspaceLoads.revision) app.set({ sessions });
    return true;
  } catch (error) { notice(String(error)); return false; }
  finally { app.set({ sessionManaging: false }); if (session.dirty && app.get().saveStatus !== '保存失败') scheduleSave(); }
}
export function closeTransient() { app.set({ menu: null, popup: '' }); }
export function closeModal() { app.set({ editor: null, preview: null, sketchPreview: false, popup: '' }); }
export function closeReader() { app.set({ preview: null, sketchPreview: false }); }

export function frameBoard(withThread = hasThreadOf(app.get())) {
  const { workspace, stage } = app.get();
  if (!workspace || !bindings.flow) return;
  void bindings.flow.setViewport(boardViewport(workspace.nodes, stage.width, stage.height, withThread, workspace.panels), { duration: reducedMotion() ? 0 : 420 });
}

// Brings a board area into view (zooming out only if it does not fit) and lets Suo's cursor mark it.
export function reveal(box: Rect, label?: string) {
  const { flow, stage: element } = bindings;
  if (flow && element) {
    const view = flow.getViewport(), area = freeArea();
    const left = view.x + box.x * view.zoom, top = view.y + box.y * view.zoom;
    if (left < area.x || top < area.y || left + box.width * view.zoom > area.x + area.width || top + box.height * view.zoom > area.y + area.height) {
      const zoom = Math.max(0.2, Math.min(view.zoom, (area.width * 0.9) / box.width, (area.height * 0.9) / box.height));
      const x = area.x + area.width / 2 - (box.x + box.width / 2) * zoom, y = area.y + area.height / 2 - (box.y + box.height / 2) * zoom;
      void flow.setViewport({ x, y, zoom }, { duration: reducedMotion() ? 0 : 420 });
    }
  }
  if (!label) return;
  const key = crypto.randomUUID();
  app.set({ presence: { key, x: box.x + 12, y: box.y - 12, label } });
  setTimeout(() => { if (app.get().presence?.key === key) app.set({ presence: null }); }, 2600);
}

// The stage area the floating panels leave free, in stage pixels.
function freeArea() {
  const state = app.get();
  return openArea(state.stage.width, state.stage.height, hasThreadOf(state), state.workspace?.panels);
}

export function center() {
  if (!bindings.flow) return { x: 200, y: 160 };
  const bounds = bindings.stage?.getBoundingClientRect(), area = freeArea();
  return bindings.flow.screenToFlowPosition({ x: (bounds?.left ?? 0) + area.x + area.width / 2 - 128, y: (bounds?.top ?? 52) + area.y + area.height / 2 - 100 });
}

export function openCreateMenu(event: { clientX: number; clientY: number }) {
  const { flow, stage: element } = bindings;
  if (!flow || !element) return;
  const bounds = element.getBoundingClientRect(), { stage } = app.get();
  app.set({ popup: '', menu: { x: Math.min(event.clientX - bounds.left, stage.width - 220), y: Math.min(event.clientY - bounds.top, stage.height - 210), point: flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }) } });
}

export function addCard(kind: CardData['kind'], point?: { x: number; y: number }, template = false) {
  if (app.get().sessionManaging) { notice('会话正在保存，请稍后再操作。'); return; }
  const fromHome = isWelcomeOf(app.get());
  const at = point ?? app.get().menu?.point ?? center();
  const card = newCard({ kind, title: template ? '产品立项 · 工作底稿' : kind === 'document' ? '新文档' : '新便签', content: template ? OUTLINE : '' }, at.x, at.y);
  entrances.set(card.id, { delay: 0 });
  record();
  update(state => ({ ...state, nodes: [...state.nodes.map(node => ({ ...node, selected: false })), { ...card, selected: true }] }));
  app.set({ menu: null, popup: '' });
  app.set({ editor: { id: card.id, title: card.data.title, content: card.data.content } });
  if (fromHome) requestAnimationFrame(() => frameBoard(true));
}

export function addTemplateCard(title: string, content: string) {
  if (app.get().sessionManaging) { notice('会话正在保存，请稍后再操作。'); return; }
  const fromHome = isWelcomeOf(app.get());
  const at = center(), card = newCard({ kind: 'document', title, content }, at.x, at.y);
  entrances.set(card.id, { delay: 0 });
  record();
  update(state => ({ ...state, nodes: [...state.nodes, card] }));
  app.set({ popup: '' });
  if (fromHome) requestAnimationFrame(() => frameBoard(true));
}

export function commitCard(id: string, title: string, content: string, recordHistory = true) {
  const card = app.get().workspace?.nodes.find(node => node.id === id);
  if (!card) return;
  const nextTitle = title.trim() || (card.data.kind === 'note' ? '新便签' : '未命名');
  if (nextTitle === card.data.title && content === card.data.content) return;
  if (recordHistory) record();
  update(state => ({ ...state, nodes: state.nodes.map(node => node.id === id ? { ...node, data: { ...node.data, title: nextTitle, content } } : node) }));
}

export function saveEditor() {
  const { editor } = app.get();
  if (!editor) return;
  commitCard(editor.id, editor.title, editor.content);
  app.set({ editor: null });
}

export function ungroup(id: string) {
  if (groupResizeGesture && !groupResizeGesture.ended) cancelGroupResize(groupResizeGesture.snapshot.groupId);
  drainNodeChanges();
  if (!app.get().workspace?.nodes.some(node => node.id === id && node.data.kind === 'group')) return;
  record();
  update(state => ({ ...state, nodes: ungroupCards(state.nodes, id), edges: state.edges.filter(edge => edge.source !== id && edge.target !== id) }));
  if (app.get().editor?.id === id) app.set({ editor: null });
}

export function groupSelected() {
  drainNodeChanges();
  if (groupSelectionPlan(app.get().workspace?.nodes ?? []).kind === 'ungroup') { notice('所选卡片已经在一个分组中；按 ⌘G 可拆开。'); return; }
  toggleGroupSelected();
}

// Cmd+G creates a group, joins the one represented in the selection, or takes it apart.
export function toggleGroupSelected() {
  if (groupResizeGesture && !groupResizeGesture.ended) cancelGroupResize(groupResizeGesture.snapshot.groupId);
  drainNodeChanges();
  if (app.get().sessionManaging) return;
  const nodes = app.get().workspace?.nodes ?? [];
  const plan = groupSelectionPlan(nodes);
  if (plan.kind === 'none') { notice(plan.reason === 'multiple-groups' ? '一次选中一个分组；也可同时选散卡加入它。' : '选中两张以上卡片成组，选中分组或成员可拆组。'); return; }
  if (plan.kind === 'ungroup') { ungroup(plan.groupId); return; }
  record();
  const groupId = plan.kind === 'create' ? crypto.randomUUID() : plan.groupId;
  const editorId = app.get().editor?.id;
  update(state => ({ ...state, nodes: (plan.kind === 'create' ? groupCards(state.nodes, groupId) : addCardsToGroup(state.nodes, groupId, plan.cardIds))
    .map(node => ({ ...node, selected: node.id === groupId || node.id === editorId })) }));
}

// Shift+Cmd+G also recognizes a selected member and can take apart several groups.
export function ungroupSelected() {
  if (groupResizeGesture && !groupResizeGesture.ended) cancelGroupResize(groupResizeGesture.snapshot.groupId);
  drainNodeChanges();
  if (app.get().sessionManaging) return;
  const groups = selectedGroupIds(app.get().workspace?.nodes ?? []);
  if (!groups.length) { notice('选中分组或其中的卡片，再按 ⇧⌘G 拆开。'); return; }
  record();
  update(state => ({ ...state, nodes: groups.reduce((nodes, id) => ungroupCards(nodes, id), state.nodes), edges: state.edges.filter(edge => !groups.includes(edge.source) && !groups.includes(edge.target)) }));
  if (groups.includes(app.get().editor?.id ?? '')) app.set({ editor: null });
}

// Drag start already recorded the gesture. Membership and bounds join that same undo step.
export function finishNodeDrag(_event: unknown, node: Card, draggedNodes: Card[] = [node]) {
  drainNodeChanges();
  if (app.get().sessionManaging) return;
  const workspace = app.get().workspace;
  if (!workspace) return;
  const nodes = reparentDraggedCards(workspace.nodes, draggedNodes.map(card => card.id));
  if (nodes !== workspace.nodes) update(state => ({ ...state, nodes }));
}

type GroupResizeGesture = { workspaceId: string; snapshot: GroupResizeSnapshot; desired: Rect; ended: boolean; cancelled: boolean; recorded?: Snapshot; previousPast?: Snapshot[]; previousFuture?: Snapshot[] };
let groupResizeGesture: GroupResizeGesture | undefined;
export function beginGroupResize(id: string) {
  drainNodeChanges();
  const workspace = app.get().workspace;
  if (!workspace || app.get().sessionManaging) return;
  const snapshot = captureGroupResize(workspace.nodes, id);
  if (!snapshot) return;
  groupResizeGesture = { workspaceId: workspace.id, snapshot, desired: snapshot.rect, ended: false, cancelled: false };
}
export function previewGroupResize(id: string, rect: Rect) {
  const gesture = groupResizeGesture;
  if (!gesture || gesture.snapshot.groupId !== id || gesture.workspaceId !== app.get().workspace?.id || gesture.cancelled) return;
  if (!gesture.recorded && (['x', 'y', 'width', 'height'] as const).some(key => rect[key] !== gesture.snapshot.rect[key])) {
    gesture.previousPast = [...history.past];
    gesture.previousFuture = history.future;
    record(); gesture.recorded = history.past.at(-1);
  }
  gesture.desired = rect;
}
export function endGroupResize(id: string) {
  if (groupResizeGesture?.snapshot.groupId !== id) return;
  drainNodeChanges();
  if (groupResizeGesture) groupResizeGesture.ended = true;
  // The library emits its final dimensions after this callback; applyNodes settles the snapshot then.
}
export const groupResizeCancelled = (id: string) => groupResizeGesture?.snapshot.groupId === id && groupResizeGesture.cancelled;
export function cancelGroupResize(id: string) {
  const gesture = groupResizeGesture;
  if (!gesture || gesture.snapshot.groupId !== id || gesture.ended || gesture.cancelled) return false;
  gesture.cancelled = true;
  drainNodeChanges();
  if (gesture.workspaceId !== app.get().workspace?.id) return false;
  if (!gesture.recorded) return true;
  update(state => ({ ...state, nodes: restoreGroupResize(state.nodes, gesture.snapshot) }));
  if (gesture.recorded && history.past.at(-1) === gesture.recorded) {
    history.past = gesture.previousPast ?? history.past.slice(0, -1); history.future = gesture.previousFuture ?? [];
    app.set(state => ({ historyVersion: state.historyVersion + 1 }));
  }
  return true;
}

export function openCard(id: string) {
  const card = app.get().workspace?.nodes.find(node => node.id === id);
  if (!card) return;
  if (card.data.kind === 'drawing') {
    if (!app.get().workspace?.drawing?.elements.some(element => !element.isDeleted)) { openDrawing(); return; }
    focusPanel('reader'); app.set({ sketchPreview: true, preview: null }); return;
  }
  if (card.data.asset) { focusPanel('reader'); app.set({ preview: card.data.asset, sketchPreview: false }); }
  else app.set({ editor: { id, title: card.data.title, content: card.data.content } });
}

// A document card as a Markdown file, titled unless its text already starts with a heading.
export function documentMarkdown(title: string, content: string) {
  const name = title.trim() || '文档', body = content.trim();
  return { name: `${name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || '文档'}.md`, text: `${/^#\s/.test(body) ? '' : `# ${name}\n\n`}${body}\n` };
}
export async function exportCard(id: string) {
  const card = app.get().workspace?.nodes.find(node => node.id === id);
  if (!card) return;
  const { name, text } = documentMarkdown(card.data.title, card.data.content);
  try { if (await saveText(name, text)) notice(`已导出「${name}」。`); }
  catch (error) { notice(error instanceof Error ? error.message : String(error)); }
}

export function measureImage(id: string, width: number, height: number) {
  const card = app.get().workspace?.nodes.find(node => node.id === id);
  const size = imageGeometry(width, height);
  if (!card || card.data.asset?.kind !== 'image' || card.data.imageAspectRatio || !size) return;
  // Intrinsic size is recorded once; a subsequent load must preserve the user's chosen size.
  update(state => ({ ...state, nodes: state.nodes.map(node => node.id === id ? {
    ...node, width: size.width, height: size.height, style: { ...node.style, width: size.width, height: size.height },
    data: { ...node.data, imageAspectRatio: size.ratio },
  } : node) }));
}

export function focusComposer() {
  requestAnimationFrame(() => {
    const area = document.querySelector<HTMLTextAreaElement>('.composer textarea');
    area?.focus();
    area?.setSelectionRange(area.value.length, area.value.length);
  });
}

// Home page start chips: put a prompt in the composer (and ask for files when the prompt needs them).
export function startWith(prompt: string, needsFiles = false) {
  const draft = app.get().workspace?.draft ?? '';
  updateDraft(draft ? `${prompt}\n\n${draft}` : prompt);
  focusComposer();
  if (needsFiles && !app.get().attachments.length) void pickFiles();
}

export function updateDraft(text: string) {
  const workspace = app.get().workspace;
  if (!workspace || workspace.draft === text) return;
  const stack = draftHistory.get(workspace.id) ?? { past: [], future: [] };
  stack.past.push(workspace.draft); if (stack.past.length > 100) stack.past.shift(); stack.future = [];
  draftHistory.set(workspace.id, stack);
  update(state => ({ ...state, draft: text }));
  app.set(state => ({ historyVersion: state.historyVersion + 1 }));
}
export function canTravelDraft(redo: boolean) {
  const id = app.get().workspace?.id;
  return !!id && !!draftHistory.get(id)?.[redo ? 'future' : 'past'].length;
}
export function travelDraftHistory(redo: boolean) {
  const workspace = app.get().workspace, stack = workspace && draftHistory.get(workspace.id);
  if (!workspace || !stack) return;
  const source = redo ? stack.future : stack.past, target = redo ? stack.past : stack.future;
  const draft = source.pop(); if (draft === undefined) return;
  target.push(workspace.draft);
  update(state => ({ ...state, draft }));
  app.set(state => ({ historyVersion: state.historyVersion + 1 })); focusComposer();
}

export function removeAttachment(id?: string) {
  update(state => ({ ...state, draftAttachments: id ? (state.draftAttachments ?? []).filter(asset => asset.id !== id) : [] }));
}

function importTarget(): ImportTarget | undefined {
  const state = app.get();
  return state.workspace ? { workspaceId: state.workspace.id, point: state.menu?.point ?? center() } : undefined;
}

function beginImport() {
  const target = importTarget();
  if (!target) return;
  session.importCount = (session.importCount ?? 0) + 1; session.importing = true;
  return target;
}
function endImport() {
  session.importCount = Math.max(0, (session.importCount ?? 0) - 1); session.importing = session.importCount > 0;
}
const nativeImports: ImportTarget[] = [];
const importJobs = new Map<string, Promise<void>>();
export function beginNativeImport() { const target = beginImport(); if (target) nativeImports.push(target); }
export async function importNativeAssets(assets: Asset[]) {
  const target = nativeImports.shift() ?? beginImport();
  try { await importAssets(assets, target); }
  catch (error) { notice(String(error)); }
  finally { if (target) endImport(); }
}

export async function importAssets(assets: Asset[], target = importTarget()) {
  if (app.get().sessionManaging) { notice('会话正在保存，请稍后再操作。'); return; }
  if (!assets.length || !target) return;
  const previous = importJobs.get(target.workspaceId) ?? Promise.resolve();
  const job = previous.catch(() => {}).then(async () => {
  const active = app.get().workspace?.id === target.workspaceId;
  const source = active ? app.get().workspace : await request<Workspace | null>('workspace.load', { id: target.workspaceId });
  if (!source || source.deletedAt) throw new Error('发起导入的会话已不存在，未将资料添加到其他会话。');
  const point = target.point;
  if (active) app.set({ menu: null, popup: '' });
  const valid = assets.filter(asset => asset.id), failures = assets.filter(asset => asset.error);
  const apply = async (change: (workspace: Workspace) => Workspace) => {
    if (app.get().workspace?.id === target.workspaceId) { update(change); return; }
    const snapshot = serialize(change(source), source.version);
    await request('workspace.save', { requestId: crypto.randomUUID(), state: snapshot, expectedVersion: source.version });
  };
  // On the home page files wait in the composer and land on the board with the first message.
  if (!source.nodes.length && !source.messages.length) {
    if (valid.length) { await apply(state => ({ ...state, draftAttachments: [...(state.draftAttachments ?? []), ...valid] })); if (active) focusComposer(); }
    if (failures.length) notice(failures.map(asset => `${asset.name}：${asset.error}`).join('\n'));
    return;
  }
  if (valid.length) {
    if (active) record();
    // Lay the batch out in two columns, in the nearest spot that covers no existing card.
    const columns = Math.min(2, valid.length), rows = Math.ceil(valid.length / columns);
    const at = freeSpot(source.nodes, point, (columns - 1) * 408 + 380, (rows - 1) * 392 + 360);
    const cards = valid.map((asset, index) => newCard({ kind: 'file', title: asset.name, content: '', asset }, at.x + (index % columns) * 408, at.y + Math.floor(index / columns) * 392));
    cards.forEach((card, index) => entrances.set(card.id, { delay: index * STAGGER }));
    await apply(state => ({ ...state, nodes: [...state.nodes.map(node => ({ ...node, selected: false })), ...cards.map(node => ({ ...node, selected: active }))] }));
    notice(`已添加 ${valid.length} 份资料${active ? '' : '到发起导入的会话'}，可在卡片里直接阅读。`);
  }
  if (failures.length) notice(failures.map(asset => `${asset.name}：${asset.error}`).join('\n'));
  });
  importJobs.set(target.workspaceId, job);
  try { await job; } finally { if (importJobs.get(target.workspaceId) === job) importJobs.delete(target.workspaceId); }
}

// Files staged on the home page belong to the first message. If the board fills some other way
// (a new note, a drawing), they land as cards instead of waiting unseen in the composer.
const stopWatchingStaged = app.subscribe(() => {
  const state = app.get();
  if (!state.attachments.length || !state.workspace || isWelcomeOf(state) || session.running) return;
  const staged = state.attachments;
  update(value => ({ ...value, draftAttachments: [] }));
  void importAssets(staged).then(() => requestAnimationFrame(() => frameBoard()));
});
import.meta.hot?.dispose(stopWatchingStaged);

export async function pickFiles() {
  if (app.get().sessionManaging) { notice('会话正在保存，请稍后再操作。'); return; }
  if (!native) { bindings.fileInput?.click(); return; }
  const target = beginImport();
  if (!target) return;
  try { await importAssets(await chooseFiles(), target); }
  catch (error) { notice(String(error)); }
  finally { endImport(); }
}

export async function importBrowserFiles(files: File[]) {
  if (app.get().sessionManaging) { notice('会话正在保存，请稍后再操作。'); return; }
  const target = beginImport();
  if (!target) return;
  try { await importAssets(await browserFiles(files), target); }
  catch (error) { notice(String(error)); }
  finally { endImport(); }
}

function shortTitle(text: string) {
  const line = text.trim().split(/[\n。！？!?]/)[0];
  return line.length > 16 ? `${line.slice(0, 16)}…` : line;
}

const LOCAL_COMMANDS: Record<string, () => void> = {
  '/note': () => addCard('note'), '/document': () => addCard('document'), '/import': () => void pickFiles(),
  '/draw': () => openDrawing(), '/help': () => app.set({ popup: 'help' }),
};
export const SLASH_COMMANDS: [string, string][] = [['/draw', '绘图'], ['/note', '新便签'], ['/document', '新文档'], ['/import', '导入文件'], ['/help', '帮助']];

const CARD = { width: 258, height: 170, gapX: 278, gapY: 260 };

// Offset from an element on screen to a card placed at `at` under viewport `view`, centre to centre.
function flightFrom(element: Element | null, at: { x: number; y: number }, view: Viewport, rotate = 0): Flight | undefined {
  const stage = bindings.stage?.getBoundingClientRect();
  if (!element || !stage || reducedMotion()) return undefined;
  const box = element.getBoundingClientRect(), { zoom } = view;
  const left = stage.left + view.x + at.x * zoom, top = stage.top + view.y + at.y * zoom;
  return {
    x: (box.left + box.width / 2 - left - CARD.width * zoom / 2) / zoom,
    y: (box.top + box.height / 2 - top - CARD.height * zoom / 2) / zoom,
    scale: Math.min(0.85, Math.max(0.25, box.width / (CARD.width * zoom))), rotate,
  };
}

// Only staged attachments become file cards. Conversation text stays in the thread.
function landAttachments(assets: Asset[]): Card[] {
  if (!assets.length) return [];
  const { stage, workspace } = app.get(), nodes = workspace?.nodes ?? [];
  const base = center(), columns = Math.min(2, assets.length), rows = Math.ceil(assets.length / columns);
  const spot = freeSpot(nodes, { x: base.x - 190, y: base.y - 140 }, columns * 408 - 28, rows * 392);
  const files = assets.map((asset, index) => newCard({ kind: 'file', title: asset.name, content: '', asset },
    spot.x + (index % columns) * 408, spot.y + Math.floor(index / columns) * 392));
  const view = !nodes.length ? boardViewport(files, stage.width, stage.height, true) : bindings.flow?.getViewport() ?? { x: 0, y: 0, zoom: 1 };
  if (!nodes.length) void bindings.flow?.setViewport(view);
  files.forEach((card, index) => {
    const paper = document.querySelector(`.attachment-paper[data-index="${Math.min(index, 2)}"]`);
    entrances.set(card.id, { delay: 0.1 + index * STAGGER, from: flightFrom(paper, card.position, view, Number(paper?.getAttribute('data-rotate') ?? 0)) });
  });
  return files;
}

// A retry reuses the original material cards.
export async function send(text = app.get().workspace?.draft ?? '', { land = true, retryMessage, retryQuestion, preserveDraft = !!retryMessage, boardTask }: { land?: boolean; retryMessage?: Message; retryQuestion?: Message; preserveDraft?: boolean; boardTask?: BoardTask } = {}) {
  if (app.get().sessionManaging) { notice('会话正在保存，请稍后再操作。'); return; }
  const sourceId = app.get().workspace?.id;
  if (session.pendingSave || app.get().saveStatus === '保存失败') {
    await flush();
    if (app.get().workspace?.id !== sourceId) return;
    if (session.pendingSave || session.dirty) { notice('保存尚未确认，请先重试保存，再继续聊天。'); return; }
  }
  const state = app.get(), assets = preserveDraft ? [] : state.attachments;
  if ((!text.trim() && !assets.length) || state.busy || !state.workspace) return;
  if (text.trim().startsWith('/')) {
    const action = LOCAL_COMMANDS[text.trim()];
    if (!action) { notice('目前支持 /draw、/note、/document、/import、/help。引擎命令暂未开放执行。'); return; }
    update(value => ({ ...value, draft: '' }));
    action();
    return;
  }
  const message = text.trim() || '帮我整理这些资料。';
  const workspace = state.workspace, referred = new Set(retryQuestion?.cardIds ?? []);
  const selected = workspace.nodes.filter(node => (retryMessage ? referred.has(node.id) : node.selected) && node.data.kind !== 'group');
  const messageId = crypto.randomUUID();
  const logicalRequestId = retryMessage?.logicalRequestId ?? crypto.randomUUID();
  const task = retryMessage ? retryQuestion?.boardTask : boardTask;
  const taskScope = task ? { boardTask: { ...task } } : {};
  const attempts = workspace.messages.filter(item => item.role === 'assistant' && item.logicalRequestId === logicalRequestId);
  const operationReceipts = [...new Map(attempts.flatMap(item => item.operationReceipts ?? []).map(receipt => [receipt.operationId, receipt])).values()];
  const run: Run = { workspaceId: workspace.id, messageId, logicalRequestId, runId: crypto.randomUUID(), preparing: new AbortController() };
  session.running = run;
  app.set({ busy: true, threadOpen: true });
  // Measured while the staged files are still on screen, then cleared.
  const landed = !land ? [] : landAttachments(assets);
  if (landed.length) record();
  const files = landed.filter(card => card.data.asset).map(card => card.id);
  if (!preserveDraft) app.set({ attachments: [] });
  update(value => ({
    ...value, title: !value.titleCustomized && value.title === '新会话' ? shortTitle(message) : value.title,
    draft: preserveDraft ? value.draft : '', draftAttachments: preserveDraft ? value.draftAttachments : [],
    nodes: [...value.nodes, ...landed],
    messages: [...value.messages, ...(!retryMessage ? [{ id: crypto.randomUUID(), role: 'user' as const, text: message, logicalRequestId, ...taskScope, cardIds: [...selected.map(card => card.id), ...files] }] : []), { id: messageId, role: 'assistant', logicalRequestId, ...(retryMessage ? { retryOf: retryMessage.id, operationReceipts } : {}), text: '' }],
  }));
  try {
    const context: Material[] = [];
    const cards = [...selected.map(card => ({ id: card.id, title: card.data.title, content: card.data.content, kind: card.data.asset?.kind ?? card.data.kind, asset: card.data.asset })), ...assets.map((asset, index) => ({ id: landed[index]?.id ?? asset.id, title: asset.name, content: '', kind: asset.kind, asset }))];
    const preparedIds = new Set<string>();
    const timeout = setTimeout(() => run.preparing?.abort(new Error('资料准备超时，请拆分后重试。')), 60000);
    try {
      for (const card of cards.slice(0, 20)) {
        try { context.push(await prepareMaterial(card, run.preparing!.signal)); preparedIds.add(card.id); }
        catch (error) {
          if (run.cancelRequested || session.running !== run) return;
          const reason = error instanceof Error ? error.message : String(error);
          context.push({ title: card.title.slice(0, 240), content: `[本轮未分析此资料：${reason}]`, note: `${card.title}：未分析，${reason}` });
        }
      }
    }
    finally { clearTimeout(timeout); }
    if (session.running !== run || run.cancelRequested) return;
    const prepared = prepareHistory(workspace.messages.map(item => ({ role: item.role, text: item.role === 'assistant' ? historyText(item) : item.text, demo: item.demo, cancelled: item.cancelled, error: !!item.error && !item.incomplete })));
    const scopeNote = cards.length ? `本轮已读取 ${preparedIds.size}/${cards.length} 份资料${cards.length > preparedIds.size ? '，其余正文未发送，可继续按目录读取' : ''}` : '';
    const notes = [scopeNote, ...context.map(item => item.note)].filter(Boolean).join('；');
    if (notes) update(value => ({ ...value, messages: value.messages.map(item => item.id === messageId ? { ...item, contextNote: notes } : item) }));
    const materialCatalog = { items: cards.slice(0, 80).map(card => ({ id: card.id, title: card.title.slice(0, 120), kind: card.kind, prepared: preparedIds.has(card.id) })), total: cards.length, prepared: preparedIds.size, ...(cards.length > 80 ? { next: 80 } : {}) };
    await request<{ runId: string }>('prompt.send', { runId: run.runId, logicalRequestId, ...taskScope, workspaceId: workspace.id, model: workspace.model, message, selected: context.map(({ note: _note, ...item }) => item), materialCatalog, history: prepared.history, historySummary: prepared.summary, summarizedTurns: prepared.summarized,
      operationReceipts, ...(retryMessage ? { retryContext: { text: retryMessage.text, steps: attempts.flatMap(item => item.steps ?? []).slice(-512) } } : {}) });
  } catch (error) {
    if (session.running !== run) return;
    const message = error instanceof Error ? error.message : String(error);
    update(value => ({ ...value, messages: value.messages.map(item => item.id === messageId ? { ...item, error: message } : item) }));
    app.set({ busy: false }); session.running = null; void flush();
  }
}

export async function stop() {
  const run = session.running;
  if (!run) return;
  run.cancelRequested = true; run.preparing?.abort();
  try { await request('prompt.abort', { runId: run.runId }); }
  catch (error) { notice(String(error)); }
  finally {
    if (session.running === run) {
      update(value => ({ ...value, messages: value.messages.map(item => item.id === run.messageId ? { ...endSteps(item), cancelled: true } : item) }));
      app.set({ busy: false }); session.running = null; void flush();
    }
  }
}

export async function copyMessage(id: string) {
  const message = app.get().workspace?.messages.find(item => item.id === id);
  const text = message?.role === 'assistant' ? replyWithSources(messageDisplayText(message), message.steps) : messageDisplayText(message);
  if (!text) return;
  try { await navigator.clipboard.writeText(text); notice('已复制。'); }
  catch { notice('复制失败，请选中文字后手动复制。'); }
}

// Retry the logical request without removing previous output or the board actions it completed.
export async function retry(id: string) {
  const sourceId = app.get().workspace?.id;
  if (app.get().saveStatus === '保存失败' || session.pendingSave) {
    await flush();
    if (app.get().workspace?.id !== sourceId) return;
    if (session.pendingSave || session.dirty) { notice('已保留成果，请先完成保存，再重试回复。'); return; }
  }
  const { workspace, busy } = app.get();
  if (!workspace || busy) return;
  const index = workspace.messages.findIndex(item => item.id === id), message = workspace.messages[index];
  if (index < 1 || message.role !== 'assistant' || (!message.error && !message.cancelled) || message.incomplete || message.retryConflict) return;
  const question = [...workspace.messages.slice(0, index)].reverse().find(item => item.role === 'user' && (!message.logicalRequestId || item.logicalRequestId === message.logicalRequestId));
  if (!question) return;
  const logicalRequestId = message.logicalRequestId ?? question.logicalRequestId ?? crypto.randomUUID();
  update(state => ({ ...state, messages: state.messages.map(item => item.id === id || item.id === question.id ? { ...item, logicalRequestId } : item) }));
  await send(question.text, { land: false, retryMessage: { ...message, logicalRequestId }, retryQuestion: question, boardTask: question.boardTask });
}

export async function continueMessage(id: string) {
  const workspace = app.get().workspace, message = workspace?.messages.at(-1);
  if (app.get().busy || !message || message.id !== id || !message.incomplete) return;
  const question = [...(workspace?.messages ?? [])].reverse().find(item => item.role === 'user' && item.logicalRequestId === message.logicalRequestId);
  await send('请接着上一条未完成的回复继续，保留已有内容和已完成操作。', { land: false, preserveDraft: true, boardTask: question?.boardTask });
}

export async function switchSession(id?: string) {
  if (app.get().sessionManaging) return;
  if (session.importing) { notice('资料正在导入，请稍等后再切换会话。'); return; }
  const revision = ++workspaceLoads.revision;
  if (app.get().busy) await stop();
  if (revision !== workspaceLoads.revision) return;
  await flush();
  if (revision !== workspaceLoads.revision) return;
  if (session.dirty) { notice('保存还没成功，请先处理保存错误。'); return; }
  if (id && app.get().workspace?.id === id) { app.set({ popup: '', menu: null }); return; }
  let value = id ? await request<Workspace>('workspace.load', { id }) : await request<Workspace>('workspace.create');
  if (revision !== workspaceLoads.revision) return;
  if (!value) { notice('会话不存在。'); return; }
  value = await hydrateDraftAttachments(value);
  if (revision !== workspaceLoads.revision) return;
  if (session.importing) { notice('资料正在导入，请稍等后再切换会话。'); return; }
  // The old session stays visible and editable while loading. Save edits made during that wait
  // before replacing it, so those keystrokes belong to the session the user could still see.
  await flush();
  if (revision !== workspaceLoads.revision) return;
  if (session.dirty || session.pendingSave) { notice('保存还没成功，请先处理保存错误。'); return; }
  if (session.importing) { notice('资料正在导入，请稍等后再切换会话。'); return; }
  session.version = value.version; session.dirty = false;
  history.past = []; history.future = [];
  app.set(state => ({ workspace: withDrawingCard({ ...value, nodes: cleanNodes(value.nodes) }), drawingOpen: false, editor: null, preview: null, sketchPreview: false, popup: '', menu: null, threadOpen: true, presence: null, attachments: value.draftAttachments ?? [], historyVersion: state.historyVersion + 1 }));
  const sessions = await request<WorkspaceSummary[]>('workspace.list');
  if (revision === workspaceLoads.revision) app.set({ sessions });
}

// Messages are placed on the board only when the user chooses the action.
function replyTitle(text: string) {
  const line = text.match(/^#{1,4}\s+(.+)$/mu)?.[1] ?? text.split('\n').find(item => item.trim()) ?? '';
  const plain = line.replace(/[*_`#>|]/gu, '').trim();
  return plain ? (plain.length > 24 ? `${plain.slice(0, 24)}…` : plain) : 'Suo 的回复';
}

export function replyToCanvas(messageId: string) {
  const workspace = app.get().workspace;
  const message = workspace?.messages.find(item => item.id === messageId);
  if (!workspace || !message || !['user', 'assistant'].includes(message.role) || message.cancelled) return;
  const text = message.role === 'assistant' ? replyWithSources(messageDisplayText(message), message.steps) : messageDisplayText(message);
  if (!text) return;
  const existing = workspace.nodes.find(node => node.data.replyId === messageId);
  if (existing) { focusCard(existing.id); reveal({ ...existing.position, width: Number(existing.style?.width ?? 380), height: Number(existing.style?.height ?? 300) }); return; }
  record();
  const source = [...workspace.nodes].reverse().find(node => node.selected && node.data.kind !== 'group') ?? workspace.nodes.at(-1);
  const position = freeSpot(workspace.nodes, { x: (source?.position.x ?? 160) + 400, y: source?.position.y ?? 140 }, 380, 300);
  const card = newCard({ kind: 'document', title: replyTitle(text), content: text, source: message.role === 'user' ? 'user' : 'ai', replyId: messageId }, position.x, position.y);
  card.style = { width: 380, height: 300 };
  entrances.set(card.id, { delay: 0 });
  update(state => ({ ...state, nodes: [...state.nodes, card] }));
  reveal({ ...position, width: 380, height: 300 });
}

// A step still running when the reply ends was cut short.
function endSteps(message: Message): Message {
  return message.steps?.some(step => step.status === 'running') ? { ...message, steps: message.steps.map(step => step.status === 'running' ? { ...step, status: 'error' as const, detail: '已停止' } : step) } : message;
}

// Suo's question with options, shown under the reply that asked it.
function showQuestion(payload: Record<string, unknown>) {
  const run = session.running;
  if (!run) throw new Error('回复已结束。');
  const question = String(payload.question ?? '').trim().slice(0, 200);
  const options = (Array.isArray(payload.options) ? payload.options : []).slice(0, 4)
    .map(item => ({ label: String(item?.label ?? '').trim().slice(0, 40), description: String(item?.description ?? '').trim().slice(0, 120) }))
    .filter(item => item.label).map(({ label, description }) => description ? { label, description } : { label });
  if (!question || options.length < 2) throw new Error('问题或选项为空。');
  update(state => ({ ...state, messages: state.messages.map(message => message.id === run.messageId ? { ...message, ask: { question, options } } : message) }));
  return { shown: true };
}

// The user picks one of Suo's options; it is sent as their reply.
export async function chooseOption(messageId: string, label: string) {
  const { workspace, busy } = app.get();
  const message = workspace?.messages.at(-1);
  if (busy || !message || message.id !== messageId || !message.ask || message.ask.answered || !message.ask.options.some(option => option.label === label)) return;
  update(state => ({ ...state, messages: state.messages.map(item => item.id === messageId && item.ask ? { ...item, ask: { ...item.ask, answered: label } } : item) }));
  await send(label, { land: false });
}

// What the model sees of an earlier reply: its text plus what that turn actually did, so a later
// "the third link" or "that card" still makes sense.
export function historyText(message: Message) {
  const done = (message.steps ?? []).map(step => `${step.label}${step.detail ? `：${step.detail}` : ''}${step.status === 'error' ? '（未完成）' : ''}${step.refs?.length ? `\n${step.refs.map(ref => `  · ${ref}`).join('\n')}` : ''}`);
  if (message.ask) done.push(`向用户提问「${message.ask.question}」，选项：${message.ask.options.map(option => option.label).join(' / ')}`);
  return done.length ? `${message.text}\n\n〔系统记录：这一轮实际执行了〕\n${done.map(line => `- ${line}`).join('\n')}`.trim() : message.text;
}

// Carries out a board, document or material request from the assistant and sends back the result.
async function answer(requestId: string, kind: string, payload: Record<string, unknown>, metadata: { logicalRequestId?: string; operationId?: string; messageId?: string } = {}) {
  let reply: { requestId: string; result?: unknown; error?: string };
  try {
    const result = kind === 'ask.user' ? showQuestion(payload) : await handleUiRequest(kind, payload, metadata);
    if (metadata.operationId) { await flush(); if (session.pendingSave || session.dirty) throw new Error('[SAVE_UNCONFIRMED] 操作已保留，但保存尚未确认；请先重试保存。'); }
    reply = { requestId, result };
  }
  catch (error) { reply = { requestId, error: error instanceof Error ? error.message : String(error) }; }
  try { await request('ui.reply', reply); } catch { /* The reply already ended. */ }
}

export function receive(event: BridgeEvent) {
  const { data } = event;
  if (event.event === 'bridge-error') {
    const running = session.running;
    if (running) update(value => ({ ...value, messages: value.messages.map(item => item.id === running.messageId ? { ...endSteps(item), error: data.message ?? '本地连接中断。' } : item) }));
    session.running = null; notice(data.message ?? '本地连接出错。'); app.set({ busy: false });
    // While the desktop host restarts the background service, saving waits for bridge-restarted.
    if (!data.restarting) void flush();
    return;
  }
  if (event.event === 'bridge-restarted') { notice('后台服务已自动恢复。'); void flush(); return; }
  const run = session.running;
  if (!run || data.workspaceId !== run.workspaceId || app.get().workspace?.id !== run.workspaceId) return;
  if (run.runId && data.runId !== run.runId) return;
  if (event.event === 'run-started') { run.runId = data.runId; app.set({ busy: true }); }
  if (event.event === 'text-delta') update(state => ({ ...state, messages: state.messages.map(message => message.id === run.messageId ? { ...message, text: message.text + (data.delta ?? '') } : message) }));
  if (event.event === 'context-info' && data.contextNote) update(state => ({ ...state, messages: state.messages.map(message => message.id === run.messageId ? { ...message, contextNote: [message.contextNote, data.contextNote].filter(Boolean).join('；') } : message) }));
  if (event.event === 'ui-request' && data.requestId) void answer(data.requestId, data.kind ?? '', data.payload ?? {}, { logicalRequestId: data.logicalRequestId ?? run.logicalRequestId, operationId: data.operationId, messageId: run.messageId });
  if (event.event === 'tool-step' && data.id) {
    const step = { id: data.id, label: data.label ?? '', status: data.status ?? 'running', ...(data.detail ? { detail: data.detail } : {}), ...(data.refs?.length ? { refs: data.refs.slice(0, 10) } : {}) };
    update(state => ({ ...state, messages: state.messages.map(message => message.id === run.messageId
      ? { ...message, steps: [...(message.steps ?? []).filter(item => item.id !== step.id), step] } : message) }));
  }
  if (event.event === 'run-settled') {
    app.set({ busy: false });
    session.running = null;
    update(state => ({ ...state, messages: state.messages.map(message => message.id === run.messageId ? { ...endSteps(message), cancelled: !!data.cancelled, error: data.error, incomplete: data.incomplete, stopReason: data.stopReason, retryConflict: data.retryConflict, saveUnconfirmed: data.saveUnconfirmed } : message) }));
    void flush();
  }
}

let nodeFrame = 0;
let queuedNodes: { id: string; changes: NodeChange<Card>[] } | undefined;
function applyNodes(changes: NodeChange<Card>[]) {
  const gesture = groupResizeGesture?.workspaceId === app.get().workspace?.id ? groupResizeGesture : undefined;
  const completedResize = gesture && changes.some(change => change.type === 'dimensions' && change.id === gesture.snapshot.groupId && change.resizing === false);
  if (gesture?.cancelled) {
    const ids = new Set(gesture.snapshot.nodes.map(node => node.id));
    changes = changes.filter(change => !((change.type === 'position' || change.type === 'dimensions') && ids.has(change.id)));
    if (completedResize) groupResizeGesture = undefined;
    if (!changes.length) return;
  }
  const persist = changes.some(change => change.type !== 'select' && !(change.type === 'dimensions' && !change.resizing && !change.setAttributes));
  update(state => ({
    ...state, nodes: gesture?.recorded && !gesture.cancelled ? resizeGroupCards(applyNodeChanges(changes, state.nodes), gesture.snapshot, gesture.desired, !completedResize) : applyNodeChanges(changes, state.nodes),
    drawingCardHidden: changes.some(change => change.type === 'remove' && state.nodes.some(node => node.id === change.id && node.data.kind === 'drawing')) ? true : state.drawingCardHidden,
  }), { persist });
  if (completedResize) groupResizeGesture = undefined;
  // A frame can contain both moving and ending events; use the resulting gesture state.
  if (app.get().workspace?.nodes.some(node => node.dragging || node.resizing)) clearTimeout(saveTimer);
  else if (!persist && session.dirty) scheduleSave();
}
export function drainNodeChanges() {
  cancelAnimationFrame(nodeFrame); nodeFrame = 0;
  const queued = queuedNodes; queuedNodes = undefined;
  if (queued && app.get().workspace?.id === queued.id) applyNodes(queued.changes);
}
export function onNodesChange(changes: NodeChange<Card>[]) {
  const id = app.get().workspace?.id;
  if (!id) return;
  const moving = changes.every(change => change.type === 'position' || change.type === 'dimensions');
  if (!moving) {
    drainNodeChanges();
    if (changes.some(change => change.type === 'remove')) record();
    applyNodes(changes); return;
  }
  if (queuedNodes?.id !== id) queuedNodes = { id, changes: [] };
  queuedNodes.changes.push(...changes);
  if (!nodeFrame) nodeFrame = requestAnimationFrame(drainNodeChanges);
}
export function onEdgesChange(changes: EdgeChange[]) {
  if (changes.some(change => change.type === 'remove')) record();
  const persist = changes.some(change => change.type !== 'select');
  update(state => ({ ...state, edges: applyEdgeChanges(changes, state.edges) }), { persist });
}
export function connect(connection: Connection) {
  record();
  update(state => ({ ...state, edges: addEdge({ ...connection, type: 'smoothstep', style: { stroke: '#a8957f', strokeWidth: 1.5 } }, state.edges) }));
}
export function saveViewport(viewport: Viewport) { update(state => ({ ...state, viewport })); }
export function panelChange(name: PanelName, rect: Rect) { update(state => ({ ...state, panels: { ...state.panels, [name]: rect } })); }
export function resetLayout() { if (app.get().sessionManaging) return; update(state => ({ ...state, panels: {} })); notice('已恢复默认布局，卡片和对话都保留。'); }

export async function loadInitial(cancelled: () => boolean) {
  const revision = ++workspaceLoads.revision;
  const list = await request<WorkspaceSummary[]>('workspace.list');
  if (cancelled() || revision !== workspaceLoads.revision) return;
  const recent = [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  let state = recent ? await request<Workspace>('workspace.load', { id: recent.id }) : await request<Workspace>('workspace.create');
  if (!state) throw new Error('最近会话不存在，请新建会话。');
  state = await hydrateDraftAttachments(state);
  if (cancelled() || revision !== workspaceLoads.revision) return;
  session.version = state.version; session.dirty = false;
  app.set({ sessions: list, workspace: withDrawingCard({ ...state, nodes: cleanNodes(state.nodes) }), attachments: state.draftAttachments ?? [] });
}

export async function handleNativeClose() {
  if (app.get().sessionManaging) { notice('会话正在保存，请稍后再操作。'); return; }
  if (session.closing) return;
  if (session.importing) { notice('资料正在导入，请稍后再关闭窗口。'); return; }
  session.closing = true;
  try {
    await request('prompt.abort');
    await new Promise(resolve => setTimeout(resolve, 40));
    await flush();
    if (session.dirty) { notice('会话尚未保存成功，窗口已保留。'); return; }
    await finishClose();
  } finally { session.closing = false; }
}

export function bindDrawingCommit(commit: () => void) {
  bindings.drawingCommit = commit;
  return () => { if (bindings.drawingCommit === commit) bindings.drawingCommit = undefined; };
}
export function openDrawing() {
  const state = app.get(), at = center();
  if (!state.workspace) return;
  const next = withDrawingCard(state.workspace, { x: at.x - 190, y: at.y - 100 }, true);
  if (next !== state.workspace) { record(); update(() => next); }
  app.set({ drawingOpen: true, popup: '', menu: null, editor: null, preview: null, sketchPreview: false });
}
export async function closeDrawing() {
  const id = app.get().workspace?.id;
  try {
    await flush();
    if (app.get().workspace?.id !== id) return false;
    if (session.dirty) { notice('草图还未保存成功，请重试。'); return false; }
    app.set({ drawingOpen: false });
    return true;
  } catch (error) { notice(String(error)); return false; }
}

export function focusCard(id: string, additive = false) {
  const workspace = app.get().workspace;
  const target = workspace?.nodes.find(node => node.id === id);
  if (!workspace || !target) return;
  const ordered = orderCards(workspace.nodes, id);
  const changed = ordered.some((node, index) => node !== workspace.nodes[index]);
  const nodes = ordered.map(node => {
    const selected = node.id === id || ((additive || target.selected) && !!node.selected);
    return node.selected === selected ? node : { ...node, selected };
  });
  update(state => ({ ...state, nodes }), { persist: changed });
}
export function updateCardMetadata(id: string, change: MetadataChange) {
  const card = app.get().workspace?.nodes.find(node => node.id === id);
  if (!card) return false;
  let patch: Partial<CardData>;
  try { patch = metadataPatch(card.data, change); }
  catch (error) { notice(error instanceof Error ? error.message : String(error)); return false; }
  if (!Object.keys(patch).length) return true;
  record();
  update(state => ({ ...state, nodes: state.nodes.map(node => node.id === id ? { ...node, data: { ...node.data, ...patch } } : node) }));
  return true;
}

export function pinCard(id: string) {
  const card = app.get().workspace?.nodes.find(node => node.id === id);
  if (!card) return;
  record();
  update(state => ({ ...state, nodes: orderCards(state.nodes, id, !card.data.pinned) }));
}
export function focusPanel(name: PanelName) {
  const layers = app.get().workspace?.panelLayers;
  const next = orderPanels(layers, name);
  if (JSON.stringify(next) !== JSON.stringify(layers)) update(state => ({ ...state, panelLayers: next }));
}
export function pinPanel(name: PanelName) {
  update(state => ({ ...state, panelLayers: orderPanels(state.panelLayers, name, !state.panelLayers?.[name]?.pinned) }));
}
export function zoomCanvasAt(clientX: number, clientY: number, delta: number) {
  const { flow, stage } = bindings;
  if (!flow || !stage || !Number.isFinite(delta)) return;
  const current = flow.getViewport(), bounds = stage.getBoundingClientRect();
  const zoom = Math.max(0.2, Math.min(2.5, current.zoom * Math.exp(-delta * 0.01)));
  const point = flow.screenToFlowPosition({ x: clientX, y: clientY });
  const next = { x: clientX - bounds.left - point.x * zoom, y: clientY - bounds.top - point.y * zoom, zoom };
  void flow.setViewport(next, { duration: 0 });
  saveViewport(next);
}
