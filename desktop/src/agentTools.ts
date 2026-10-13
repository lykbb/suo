import type { Edge } from '@xyflow/react';
import { animateIn, center, frameBoard, newCard, record, reveal, update } from './actions';
import { CARD_COLORS, metadataPatch, readCardTags } from './cardMetadata';
import { freeSpot, nodeBoxes, ungroupCards } from './geometry';
import { arrangeBoardNodes, classifyBoardNodes } from './boardLayout';
import { browserRead, browserSearch } from './bridge';
import { readMaterial, searchMaterials } from './materialContext';
import { app } from './state';
import { disconnectEdges } from './cardLinks';
import type { Card, OperationReceipt, Rect, Workspace } from './types';

// The interface side of the assistant's board, document and material tools. The backend asks,
// these functions act on the current session through the same update/record path as the user, so
// every change is saved and can be undone.

type Layout = 'grid' | 'row' | 'column';
type Input = Record<string, unknown>;
export type OperationContext = { logicalRequestId?: string; operationId?: string; messageId?: string; inputHash?: string; input?: Input; kind?: string };
const GAP = 24, DOCUMENT = { width: 340, height: 260 };
const short = (id: string) => id.slice(0, 8);
const text = (value: unknown, max: number) => typeof value === 'string' ? value.slice(0, max) : '';
const list = (value: unknown) => Array.isArray(value) ? value : [];
const byAssistant = (card: Card) => card.data.source === 'ai' || card.data.source === 'demo';
const noteHeight = (content: string) => Math.min(320, 96 + Math.ceil(content.length / 15) * 22);

// Canonical JSON plus SHA-256 keeps replay independent of object key order and random request IDs.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(item => canonical(item)).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Input).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
async function fingerprint(value: unknown) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function durableNode(card: Card) {
  const { asset, ...data } = card.data;
  return { id: card.id, type: card.type, position: card.position, parentId: card.parentId, style: card.style, data: { ...data,
    ...(asset ? { asset: { id: asset.id, name: asset.name, kind: asset.kind, size: asset.size, mime: asset.mime } } : {}) } };
}
function receipts(workspace: Workspace, logicalRequestId: string) {
  const found = new Map<string, OperationReceipt>();
  for (const message of workspace.messages) for (const item of message.operationReceipts ?? []) if (item.logicalRequestId === logicalRequestId) found.set(item.operationId, item);
  return [...found.values()].sort((a, b) => Number(a.operationId.split(':').at(-1)) - Number(b.operationId.split(':').at(-1)));
}
const conflict = (reason: string) => new Error(`[RETRY_CONFLICT] 重试暂停：${reason}。已执行的成果和历史记录仍保留；请先检查画布，再说明要继续的任务。`);
async function reuseOperation(kind: string, input: Input, operation: OperationContext) {
  if (!operation.logicalRequestId || !operation.operationId || !operation.messageId) return undefined;
  const workspace = board(), all = receipts(workspace, operation.logicalRequestId), previous = all.find(item => item.operationId === operation.operationId);
  operation.inputHash = await fingerprint(input); operation.input = input; operation.kind = kind;
  if (!previous) return undefined;
  if (previous.kind !== kind || previous.inputHash !== operation.inputHash) throw conflict('这次操作与前次已执行操作的类型或参数不同');
  const nodes = Object.assign({}, ...all.map(item => item.nodeStates ?? {})) as Record<string, string | null>;
  const edges = Object.assign({}, ...all.map(item => item.edgeStates ?? {})) as Record<string, string | null>;
  for (const [id, expected] of Object.entries(nodes)) {
    const node = workspace.nodes.find(node => node.id === id);
    if ((node ? await fingerprint(durableNode(node)) : null) !== expected) throw conflict('前次操作影响的卡片已被修改、撤销或移除');
  }
  for (const [id, expected] of Object.entries(edges)) {
    const item = workspace.edges.find(edge => edge.id === id);
    if ((item ? await fingerprint(item) : null) !== expected) throw conflict('前次操作影响的连线已被修改、撤销或移除');
  }
  const current = board();
  if (current.id !== workspace.id || current.nodes !== workspace.nodes || current.edges !== workspace.edges) throw conflict('核对期间画布发生了变化');
  return { ...previous.result, replayed: true };
}
async function commitOperation(before: Workspace, nodes: Card[], edges: Edge[], result: Input, operation?: OperationContext, options = { includeViewport: false }) {
  let receipt: OperationReceipt | undefined;
  if (operation?.logicalRequestId && operation.operationId && operation.messageId && operation.inputHash && operation.input) {
    const nodeStates: Record<string, string | null> = {}, edgeStates: Record<string, string | null> = {};
    const priorNodes = new Map(before.nodes.map(node => [node.id, node])), nextNodes = new Map(nodes.map(node => [node.id, node]));
    const priorEdges = new Map(before.edges.map(edge => [edge.id, edge])), nextEdges = new Map(edges.map(edge => [edge.id, edge]));
    for (const id of new Set([...priorNodes.keys(), ...nextNodes.keys()])) {
      const prior = priorNodes.get(id), next = nextNodes.get(id);
      if (canonical(prior ? durableNode(prior) : null) !== canonical(next ? durableNode(next) : null)) nodeStates[id] = next ? await fingerprint(durableNode(next)) : null;
    }
    for (const id of new Set([...priorEdges.keys(), ...nextEdges.keys()])) if (canonical(priorEdges.get(id)) !== canonical(nextEdges.get(id))) edgeStates[id] = nextEdges.has(id) ? await fingerprint(nextEdges.get(id)) : null;
    receipt = { operationId: operation.operationId, logicalRequestId: operation.logicalRequestId, kind: operation.kind ?? '', inputHash: operation.inputHash, input: operation.input, result, nodeStates, edgeStates };
  }
  const current = board();
  if (current.id !== before.id || current.nodes !== before.nodes || current.edges !== before.edges) throw conflict('操作准备期间画布发生了变化');
  if (receipt && !current.messages.some(message => message.id === operation?.messageId && message.logicalRequestId === receipt.logicalRequestId)) throw conflict('本轮回复记录已改变');
  const changed = canonical(nodes.map(durableNode)) !== canonical(before.nodes.map(durableNode)) || canonical(edges) !== canonical(before.edges);
  const geometry = (cards: Card[]) => { const boxes = nodeBoxes(cards); return cards.map((card, index) => ({ id: card.id, parentId: card.parentId, box: boxes[index] })).sort((a, b) => a.id.localeCompare(b.id)); };
  const geometryChanged = options.includeViewport && canonical(geometry(nodes)) !== canonical(geometry(before.nodes));
  if (changed) record(options);
  if (changed || receipt) update(state => ({ ...state, nodes, edges, ...(receipt ? { messages: state.messages.map(message => message.id === operation?.messageId ? { ...message,
    operationReceipts: [...(message.operationReceipts ?? []).filter(item => item.operationId !== receipt.operationId), receipt] } : message) } : {}) }));
  if (geometryChanged) frameBoard();
}

function board() {
  const workspace = app.get().workspace;
  if (!workspace) throw new Error('当前没有打开的会话。');
  return workspace;
}
// Cards are named to the model by the first 8 characters of their id.
function find(id: unknown, nodes = board().nodes) {
  const key = String(id ?? '').trim();
  const exact = nodes.find(node => node.id === key);
  if (exact) return exact;
  const matches = key.length >= 6 ? nodes.filter(node => node.id.startsWith(key)) : [];
  if (matches.length !== 1) throw new Error(`找不到编号为 ${key || '（空）'} 的卡片`);
  return matches[0];
}
const edge = (source: string, target: string, label: string): Edge => ({ id: crypto.randomUUID(), source, target, type: 'smoothstep', ...(label ? { label } : {}), style: { stroke: '#a8957f', strokeWidth: 1.5 } });

// A table of blocks: each column as wide as its widest block, each row as tall as its tallest, so
// mixed sizes (a group beside notes) line up without large gaps.
function table(sizes: { width: number; height: number }[], layout: Layout, columns?: unknown) {
  const count = sizes.length, wanted = Number(columns);
  const cols = layout === 'row' ? count : layout === 'column' ? 1 : Number.isFinite(wanted) && wanted >= 1 ? Math.min(count, Math.round(wanted)) : Math.min(4, Math.ceil(Math.sqrt(count)));
  const widths = Array<number>(cols).fill(0), heights = Array<number>(Math.ceil(count / cols)).fill(0);
  sizes.forEach((size, index) => { widths[index % cols] = Math.max(widths[index % cols], size.width); heights[Math.floor(index / cols)] = Math.max(heights[Math.floor(index / cols)], size.height); });
  const starts = (values: number[]) => values.map((_, index) => values.slice(0, index).reduce((sum, value) => sum + value + GAP, 0));
  const xs = starts(widths), ys = starts(heights), total = (values: number[]) => values.reduce((sum, value) => sum + value, 0) + GAP * (values.length - 1);
  return { width: total(widths), height: total(heights), at: sizes.map((_, index) => ({ x: xs[index % cols], y: ys[Math.floor(index / cols)] })) };
}
const layoutOf = (value: unknown): Layout => value === 'row' || value === 'column' ? value : 'grid';

// Colors by their names in the appearance panel (浅黄, or just 黄 / yellow) or as hex; 默认 clears.
const ENGLISH: Record<string, string> = { gray: '浅灰', grey: '浅灰', yellow: '浅黄', green: '浅绿', blue: '浅蓝', purple: '浅紫', pink: '浅粉', orange: '浅橙' };
function colorValue(value: unknown): string | null {
  const name = String(value ?? '').trim();
  if (!name || /^(默认|无|清除|白色?|none|default|clear)$/iu.test(name)) return null;
  const preset = CARD_COLORS.find(item => item.value && (item.name === name || item.name === `浅${name}` || item.name === ENGLISH[name.toLowerCase()]));
  if (preset) return preset.value;
  if (/^#?[0-9a-f]{3}([0-9a-f]{3})?$/iu.test(name)) return name.startsWith('#') ? name : `#${name}`;
  throw new Error(`不认识的颜色「${name}」，可用：${CARD_COLORS.filter(item => item.value).map(item => item.name).join('、')}、默认，或 #RRGGBB`);
}
const colorName = (value: unknown) => CARD_COLORS.find(item => item.value && item.value === value)?.name ?? (typeof value === 'string' ? value : undefined);
// Color, tags and pin on one card, through the same checks as the appearance panel.
function styled(card: Card, change: Input): Card {
  const metadata: { color?: string | null; tags?: string[] } = {};
  if ('color' in change) metadata.color = colorValue(change.color);
  if (Array.isArray(change.tags)) metadata.tags = change.tags.map(tag => String(tag));
  const data = { ...card.data, ...metadataPatch(card.data, metadata), ...(typeof change.pinned === 'boolean' ? { pinned: change.pinned } : {}) };
  if ('color' in metadata && !metadata.color) delete data.color;
  return { ...card, data };
}
// A card taken out of its group keeps its place on the board.
function detach(nodes: Card[], id: string) {
  const boxes = nodeBoxes(nodes), index = nodes.findIndex(node => node.id === id);
  return nodes.map((node, at) => at === index && node.parentId ? { ...node, parentId: undefined, position: { x: boxes[index].x, y: boxes[index].y } } : node);
}
const size = (node: Card) => nodeBoxes([node])[0];

// Wraps top-level cards in a new group, keeping their place on the board.
function groupNodes(nodes: Card[], ids: Set<string>, title: string) {
  for (const id of ids) if (nodes.find(node => node.id === id)?.parentId) nodes = detach(nodes, id);
  const members = nodes.filter(node => ids.has(node.id) && !node.parentId && node.data.kind !== 'group');
  if (!members.length) throw new Error('这些卡片已经在别的分组里，或不能分组');
  const boxes = nodeBoxes(members);
  const x = Math.min(...boxes.map(box => box.x)) - GAP, y = Math.min(...boxes.map(box => box.y)) - 44;
  const right = Math.max(...boxes.map(box => box.x + box.width)) + GAP, bottom = Math.max(...boxes.map(box => box.y + box.height)) + GAP;
  const group: Card = { id: crypto.randomUUID(), type: 'group', position: { x, y }, style: { width: right - x, height: bottom - y }, data: { kind: 'group', title, content: '', source: 'ai' } };
  const inside = new Set(members.map(node => node.id));
  return { id: group.id, nodes: [group, ...nodes.map(node => inside.has(node.id) ? { ...node, parentId: group.id, position: { x: node.position.x - x, y: node.position.y - y } } : node)] };
}

// Where a new block goes: beside a named card, or the free spot nearest the middle of the view.
function anchor(nodes: Card[], near: unknown, width: number, height: number) {
  let start = center();
  if (near) {
    const target = find(near, nodes), box = nodeBoxes(nodes)[nodes.indexOf(target)];
    start = { x: box.x + box.width + 80, y: box.y };
  }
  return freeSpot(nodes, start, width, height);
}

function readBoard(input: Input) {
  const { nodes, edges } = board();
  const all = nodeBoxes(nodes), boxOf = new Map(nodes.map((node, index) => [node.id, all[index]]));
  const where = (node: Card) => { const box = boxOf.get(node.id)!; return [box.x, box.y, box.width, box.height].map(Math.round); };
  const looks = (node: Card) => ({ color: colorName(node.data.color), tags: readCardTags(node.data.tags), pinned: !!node.data.pinned, box: where(node) });
  const cards = nodes.filter(node => node.data.kind !== 'group' && (!input.selectedOnly || node.selected));
  const offset = Number.isSafeInteger(input.offset) && Number(input.offset) >= 0 ? Number(input.offset) : 0;
  const listed = cards.slice(offset, offset + 80), groups = nodes.filter(node => node.data.kind === 'group');
  return {
    cards: listed.map(node => ({ id: node.id, kind: node.data.asset ? 'file' : node.data.kind, fileKind: node.data.asset?.kind, title: node.data.title || '未命名',
      excerpt: node.data.asset ? '' : (node.data.content ?? '').slice(0, 240), group: node.parentId, selected: !!node.selected, byAssistant: byAssistant(node), ...looks(node) })),
    groups: groups.slice(offset, offset + 80).map(node => ({ id: node.id, parentId: node.parentId, title: node.data.title, ...looks(node) })), groupsTotal: groups.length, groupsOmitted: Math.max(0, groups.length - Math.min(80, Math.max(0, groups.length - offset))),
    links: edges.slice(0, 120).map(item => ({ id: item.id, from: item.source, to: item.target, sourceHandle: item.sourceHandle ?? null, targetHandle: item.targetHandle ?? null, label: typeof item.label === 'string' ? item.label : undefined })),
    selected: nodes.filter(node => node.selected && node.data.kind !== 'group').length, omitted: cards.length - listed.length, total: cards.length, offset,
    ...(offset + 80 < Math.max(cards.length, groups.length) ? { next: offset + 80 } : {}),
  };
}

async function writeBoard(input: Input, operation?: OperationContext) {
  const before = board(), { nodes } = before, items = list(input.cards).slice(0, 30) as Input[];
  if (!items.length) throw new Error('没有要放置的卡片。');
  const kinds = items.map(item => item?.kind === 'document' ? 'document' as const : 'note' as const);
  const cell = kinds.includes('document') ? DOCUMENT : { width: 258, height: Math.max(...items.map(item => noteHeight(text(item?.content, 20000)))) };
  const block = table(items.map(() => cell), layoutOf(input.layout)), title = text(input.group, 80).trim();
  const pad = title ? { left: GAP, top: 44, width: GAP * 2, height: 44 + GAP } : { left: 0, top: 0, width: 0, height: 0 };
  const spot = anchor(nodes, input.near, block.width + pad.width, block.height + pad.height);
  const created = items.map((item, index) => {
    const kind = kinds[index], content = text(item?.content, 20000);
    let card = newCard({ kind, title: text(item?.title, 120).trim() || (kind === 'document' ? '文档' : '要点'), content, source: 'ai' },
      spot.x + pad.left + block.at[index].x, spot.y + pad.top + block.at[index].y);
    card.style = kind === 'document' ? { ...DOCUMENT } : { width: 258, height: cell.height };
    try { if (item?.color !== undefined || Array.isArray(item?.tags)) card = styled(card, item); } catch { /* A bad color or tag leaves the card plain. */ }
    return { key: text(item?.key, 40).trim(), card };
  });
  const keys = new Map(created.filter(item => item.key).map(item => [item.key, item.card.id]));
  const all = [...nodes, ...created.map(item => item.card)];
  const ref = (value: unknown) => keys.get(String(value)) ?? find(value, all).id;
  const links: Edge[] = [];
  let skipped = 0;
  for (const link of list(input.links).slice(0, 60) as Input[]) {
    try { links.push(edge(ref(link?.from), ref(link?.to), text(link?.label, 40))); } catch { skipped++; }
  }
  let next = all, group: string | undefined;
  if (title) ({ nodes: next, id: group } = groupNodes(all, new Set(created.map(item => item.card.id)), title));
  if (group && input.group_color !== undefined) { try { next = next.map(node => node.id === group ? styled(node, { color: input.group_color }) : node); } catch { /* Plain group. */ } }
  const result = { created: created.map(item => ({ ...(item.key ? { key: item.key } : {}), id: short(item.card.id) })), ...(group ? { group: short(group) } : {}), links: links.length, skippedLinks: skipped };
  await commitOperation(before, next, [...before.edges, ...links], result, operation);
  if (group) animateIn(group, 0);
  created.forEach((item, index) => animateIn(item.card.id, 0.08 + index * 0.05));
  reveal({ x: spot.x, y: spot.y, width: block.width + pad.width, height: block.height + pad.height }, `Suo · 整理了 ${created.length} 张卡片`);
  return result;
}

async function editBoard(input: Input, operation?: OperationContext) {
  const changes = list(input.changes).slice(0, 40) as Input[];
  if (!changes.length) throw new Error('没有要执行的调整。');
  const before = board(); let { nodes, edges } = before;
  const done: string[] = [], failed: string[] = [], editing = app.get().editor?.id;
  for (const change of changes) {
    try {
      if (change?.action === 'update') {
        const card = find(change.id, nodes);
        if (card.id === editing) throw new Error('用户正在编辑这张卡片');
        if (card.data.asset && typeof change.content === 'string') throw new Error('资料卡片的内容不能修改，只能改标题');
        const title = text(change.title, 120).trim(), content = typeof change.content === 'string' && card.data.kind !== 'group' ? text(change.content, 100000) : undefined;
        nodes = nodes.map(node => node.id === card.id ? { ...node, data: { ...node.data, ...(title ? { title } : {}), ...(content !== undefined ? { content } : {}) } } : node);
        done.push('修改');
      } else if (change?.action === 'style') {
        const targets = new Set((change.ids ? list(change.ids) : [change.id]).map(id => find(id, nodes).id));
        nodes = nodes.map(node => targets.has(node.id) ? styled(node, change) : node);
        done.push('外观');
      } else if (change?.action === 'move') {
        const card = find(change.id, nodes), box = size(card), others = nodes.filter(node => node.id !== card.id && node.parentId !== card.id);
        let target: { x: number; y: number };
        if (change.near) {
          const near = find(change.near, nodes), around = nodeBoxes(nodes)[nodes.indexOf(near)], side = String(change.side ?? 'right');
          const start = side === 'below' ? { x: around.x, y: around.y + around.height + GAP } : side === 'above' ? { x: around.x, y: around.y - box.height - GAP }
            : side === 'left' ? { x: around.x - box.width - GAP, y: around.y } : { x: around.x + around.width + GAP, y: around.y };
          target = card.parentId ? start : freeSpot(others.filter(node => !node.parentId), start, box.width, box.height);
        } else if (Number.isFinite(Number(change.x)) && Number.isFinite(Number(change.y))) target = { x: Number(change.x), y: Number(change.y) };
        else throw new Error('move 需要 near（放在哪张卡片旁边）或 x、y 坐标');
        const parent = card.parentId ? nodeBoxes(nodes)[nodes.findIndex(node => node.id === card.parentId)] : null;
        nodes = nodes.map(node => node.id === card.id ? { ...node, position: parent ? { x: target.x - parent.x, y: target.y - parent.y } : target } : node);
        done.push('移动');
      } else if (change?.action === 'resize') {
        const card = find(change.id, nodes), width = Number(change.width), height = Number(change.height);
        if (!Number.isFinite(width) && !Number.isFinite(height)) throw new Error('resize 需要 width 或 height');
        const current = size(card), clamp = (value: number, low: number) => Math.round(Math.min(2400, Math.max(low, value)));
        nodes = nodes.map(node => node.id === card.id ? { ...node, style: { ...node.style, width: clamp(Number.isFinite(width) ? width : current.width, 120), height: clamp(Number.isFinite(height) ? height : current.height, 80) } } : node);
        done.push('调整大小');
      } else if (change?.action === 'group') {
        const { nodes: next, id } = groupNodes(nodes, new Set(list(change.ids).map(id => find(id, nodes).id)), text(change.title, 80).trim() || '新分组');
        nodes = change.color !== undefined ? next.map(node => node.id === id ? styled(node, { color: change.color }) : node) : next;
        done.push('分组');
      } else if (change?.action === 'ungroup') {
        const group = find(change.id, nodes);
        if (group.data.kind !== 'group') throw new Error('这不是分组');
        nodes = ungroupCards(nodes, group.id);
        done.push('拆开分组');
      } else if (change?.action === 'arrange') {
        const members = list(change.ids).map(id => find(id, nodes));
        if (!members.length) throw new Error('没有要排列的卡片');
        nodes = arrangeBoardNodes(nodes, { ids: members.map(node => node.id), layout: layoutOf(change.layout), columns: Number(change.columns) || undefined });
        done.push('排列');
      } else if (change?.action === 'link') {
        edges = [...edges, edge(find(change.from, nodes).id, find(change.to, nodes).id, text(change.label, 40))];
        done.push('连线');
      } else if (change?.action === 'unlink') {
        const edgeId = text(change.edgeId, 240).trim();
        const from = change.from ? find(change.from, nodes).id : undefined, to = change.to ? find(change.to, nodes).id : undefined;
        edges = disconnectEdges(edges, { edgeId: edgeId || undefined, from, to, all: change.all === true });
        done.push('删除连线');
      } else if (change?.action === 'remove') {
        const card = find(change.id, nodes);
        if (card.id === editing) throw new Error('用户正在编辑这张卡片');
        if (card.data.kind === 'group') nodes = ungroupCards(nodes, card.id);
        nodes = nodes.filter(node => node.id !== card.id);
        edges = edges.filter(item => item.source !== card.id && item.target !== card.id);
        done.push('删除');
      } else throw new Error(`不支持的操作“${String(change?.action)}”`);
    } catch (error) { failed.push(`${String(change?.action ?? '?')}：${error instanceof Error ? error.message : String(error)}`); }
  }
  if (failed.length && changes.some(change => change?.action === 'arrange')) throw new Error(`整理未执行，整批改动已保留原状：${failed.join('；')}`);
  const result = { summary: `完成 ${done.length} 项调整${failed.length ? `；${failed.length} 项未执行：${failed.join('；')}` : ''}。`, done: done.length, failed: failed.length };
  await commitOperation(before, nodes, edges, result, operation, { includeViewport: changes.some(change => change?.action === 'arrange') });
  return result;
}

// Headings are Markdown (#…) or the numbered chapter lines the templates use (一、背景与问题).
function heading(line: string) {
  const mark = line.match(/^(#{1,6})\s+(.*)$/u);
  if (mark) return { level: mark[1].length, name: mark[2] };
  return /^([一二三四五六七八九十]+、|第[一二三四五六七八九十\d]+[章节部分])/u.test(line.trim()) ? { level: 2, name: line.trim() } : null;
}
const bare = (name: string) => name.replace(/^#+\s*/u, '').replace(/^([一二三四五六七八九十]+、|\d+[.、]\s*|第[一二三四五六七八九十\d]+[章节部分]\s*)/u, '').trim().toLowerCase();
export function replaceSection(markdown: string, section: string, body: string) {
  const want = bare(section);
  if (!want) throw new Error('请指定要替换的章节标题。');
  const lines = markdown.split('\n'), start = lines.findIndex(line => { const found = heading(line); return !!found && bare(found.name) === want; });
  if (start < 0) return `${markdown.trimEnd()}\n\n## ${section.replace(/^#+\s*/u, '').trim()}\n\n${body.trim()}\n`;
  const level = heading(lines[start])!.level;
  let end = lines.findIndex((line, index) => index > start && (heading(line)?.level ?? 99) <= level);
  if (end < 0) end = lines.length;
  return [...lines.slice(0, start + 1), '', body.trim(), '', ...lines.slice(end)].join('\n').replace(/\n{3,}/gu, '\n\n');
}

async function writeDocument(input: Input, operation?: OperationContext) {
  const before = board();
  const content = text(input.content, 100000), mode = typeof input.mode === 'string' ? input.mode : input.id ? 'replace' : 'create';
  if (!input.id || mode === 'create') {
    const { nodes } = board(), spot = anchor(nodes, undefined, 380, 320);
    const card = newCard({ kind: 'document', title: text(input.title, 120).trim() || '文档', content, source: 'ai' }, spot.x, spot.y);
    card.style = { width: 380, height: 320 };
    const result = { id: short(card.id), title: card.data.title, created: true, length: content.length };
    await commitOperation(before, [...before.nodes, card], before.edges, result, operation);
    animateIn(card.id, 0);
    reveal({ ...spot, width: 380, height: 320 } as Rect, 'Suo · 新建了文档');
    return result;
  }
  const card = find(input.id);
  if (card.data.asset || !['document', 'note'].includes(card.data.kind)) throw new Error('只能修改文档或便签卡片。');
  if (app.get().editor?.id === card.id) throw new Error('用户正在编辑这份文档，请稍后再改。');
  const current = card.data.content ?? '', title = text(input.title, 120).trim() || card.data.title;
  const next = mode === 'append' ? `${current.trimEnd()}\n\n${content}` : mode === 'section' ? replaceSection(current, text(input.section, 120), content) : content;
  const result = { id: short(card.id), title, created: false, length: next.length };
  await commitOperation(before, before.nodes.map(node => node.id === card.id ? { ...node, data: { ...node.data, title, content: next } } : node), before.edges, result, operation);
  return result;
}

function readable(card: Card) {
  if (card.data.kind === 'group' || card.data.kind === 'drawing') throw new Error('这张卡片没有可读取的文字。');
  return { title: card.data.title || '未命名', content: card.data.content ?? '', asset: card.data.asset };
}

export async function handleUiRequest(kind: string, input: Input, operation: OperationContext = {}) {
  // Only requests that change the board need the user's 智能归类 authorization; reading, search and
  // materials work without looking at it.
  const changes = ['board.write', 'board.edit', 'document.write', 'board.organize'].includes(kind);
  const user = changes ? [...board().messages].reverse().find(message => message.role === 'user' && (!operation.logicalRequestId || message.logicalRequestId === operation.logicalRequestId)) : undefined;
  if (user?.boardTask && (kind !== 'board.organize' || input.mode !== 'classify' || input.allowRegroup === true && !user.boardTask.allowRegroup)) throw new Error('本轮智能归类只允许授权的主题关系调整；不能新建卡片、修改文档或改坐标。');
  if (changes) {
    const previous = await reuseOperation(kind, input, operation);
    if (previous) return previous;
  }
  const signal = AbortSignal.timeout(110000);
  switch (kind) {
    case 'board.read': return readBoard(input);
    case 'board.write': return writeBoard(input, operation);
    case 'board.edit': return editBoard(input, operation);
    case 'document.write': return writeDocument(input, operation);
    case 'board.organize': {
      const before = board();
      let nodes: Card[];
      if (input.mode === 'arrange') nodes = arrangeBoardNodes(before.nodes, { ...(Array.isArray(input.ids) ? { ids: input.ids.map(id => find(id).id) } : {}), layout: layoutOf(input.layout), columns: Number(input.columns) || undefined });
      else if (input.mode === 'classify') {
        if (input.allowRegroup === true) {
          const request = [...before.messages].reverse().find(message => message.role === 'user' && (!operation.logicalRequestId || message.logicalRequestId === operation.logicalRequestId))?.text ?? '';
          if (user?.boardTask ? !user.boardTask.allowRegroup : !/(?:重新|重做|重建)(?:归类|分组)|(?:允许|可以|请|帮我).*?(?:调整|改变|重组)现有分组关系/u.test(request) || /(?:不|别|禁止|无需|不要)[^。！？\n]{0,20}(?:重新归类|重新分组|重组|调整现有分组)/u.test(request)) throw new Error('重新归类需要用户明确允许调整现有分组；当前授权不包含这项改动。');
        }
        const groups = list(input.groups).map(item => ({ id: String(item.id ?? '').startsWith('new:') ? String(item.id) : find(item.id).id, title: text(item.title, 120), memberIds: list(item.memberIds).map(id => String(id).startsWith('new:') ? String(id) : find(id).id) }));
        nodes = classifyBoardNodes(before.nodes, { groups }, { allowRegroup: input.allowRegroup === true });
      } else throw new Error('整理方式无效，请选择 arrange 或 classify。');
      const result = { summary: input.mode === 'classify' ? '已按主题归类并整齐排列。' : '已整齐排列，保留现有分组关系。', cards: nodes.filter(node => node.data.kind !== 'group').length, groups: nodes.filter(node => node.data.kind === 'group').length };
      await commitOperation(before, nodes, before.edges, result, operation, { includeViewport: true });
      return result;
    }
    case 'material.read': return readMaterial(readable(find(input.id)), Number(input.offset) || 0, signal, !!input.images);
    case 'material.search': {
      const cards = board().nodes.filter(node => node.data.kind !== 'group' && node.data.kind !== 'drawing').map(node => ({ id: node.id, ...readable(node) }));
      return searchMaterials(cards, text(input.query, 200), signal, Number.isSafeInteger(input.offset) && Number(input.offset) >= 0 ? Number(input.offset) : 0);
    }
    case 'web.search': {
      // Baidu finds Chinese pages far better than Bing does without a signed-in session.
      const query = text(input.query, 200), first = /[\u3400-\u9fff]/u.test(query) ? 'baidu' : 'bing';
      // A verification page or a timeout on one engine is retried once on the other.
      try { return await browserSearch(query, first); }
      catch (error) { if (/格式|200 字/.test(String(error))) throw error; return browserSearch(query, first === 'baidu' ? 'bing' : 'baidu'); }
    }
    case 'web.read': return browserRead(text(input.url, 2000));
    default: throw new Error('未知的界面操作。');
  }
}
