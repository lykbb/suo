import type { Card } from './types';
import { cardSize } from './grouping.ts';

export type Arrangement = { ids?: string[]; layout?: 'grid' | 'row' | 'column'; columns?: number };
export type Classification = { groups: { id: string; title?: string; memberIds: string[] }[] };
const round = (n: number) => Math.round(n * 1000) / 1000;
const PAD = 24, HEADER = 44;

// All planning is pure. The caller records and commits only after the entire plan succeeds.
export function validateBoard(nodes: Card[]) {
  if (!Array.isArray(nodes) || nodes.length > 2000) throw new Error('画布格式或容量不正确。');
  const byId = new Map<string, Card>();
  for (const node of nodes) {
    if (!node.id || byId.has(node.id) || !Number.isFinite(node.position?.x) || !Number.isFinite(node.position?.y)) throw new Error('元素编号重复或坐标无效，未执行整理。');
    byId.set(node.id, node);
  }
  const done = new Set<string>();
  const visit = (node: Card, path: Set<string>) => {
    if (done.has(node.id)) return;
    if (path.has(node.id)) throw new Error('分组存在循环关系，未执行整理。');
    path.add(node.id);
    if (node.parentId) {
      const parent = byId.get(node.parentId);
      if (!parent || parent.data.kind !== 'group') throw new Error('元素所属分组不存在，未执行整理。');
      visit(parent, path);
    }
    path.delete(node.id); done.add(node.id);
  };
  nodes.forEach(node => visit(node, new Set()));
  return byId;
}

type Box = { id: string; width: number; height: number };
type Packing = { at: Map<string, { x: number; y: number }>; width: number; height: number };
function pack(boxes: Box[], options: Arrangement): Packing {
  if (!boxes.length) return { at: new Map(), width: 0, height: 0 };
  const widths = boxes.map(box => box.width).sort((a, b) => a - b);
  const gap = Math.max(16, Math.min(32, Math.round(widths[Math.floor(widths.length / 2)] * 0.08)));
  const stable = [...boxes].sort((a, b) => b.height - a.height || b.width - a.width || a.id.localeCompare(b.id));
  if (options.layout === 'row' || options.layout === 'column') {
    let x = 0, y = 0, width = 0, height = 0;
    const at = new Map<string, { x: number; y: number }>();
    for (const box of stable) {
      at.set(box.id, { x: round(x), y: round(y) });
      width = Math.max(width, x + box.width); height = Math.max(height, y + box.height);
      if (options.layout === 'row') x += box.width + gap; else y += box.height + gap;
    }
    return { at, width: round(width), height: round(height) };
  }
  const maxWidth = Math.max(...widths), area = stable.reduce((sum, box) => sum + (box.width + gap) * (box.height + gap), 0);
  const desired = Math.sqrt(area * 1.35);
  const columns = options.columns;
  if (columns !== undefined && (!Number.isSafeInteger(columns) || columns < 1 || columns > 32)) throw new Error('排列列数应为 1 到 32。');
  if (columns) {
    const at = new Map<string, { x: number; y: number }>();
    let y = 0, width = 0;
    for (let start = 0; start < stable.length; start += columns) {
      const row = stable.slice(start, start + columns);
      let x = 0;
      for (const box of row) { at.set(box.id, { x: round(x), y: round(y) }); width = Math.max(width, x + box.width); x += box.width + gap; }
      y += Math.max(...row.map(box => box.height)) + gap;
    }
    return { at, width: round(width), height: round(y - gap) };
  }
  const candidates = [...new Set([maxWidth, desired * 0.8, desired, desired * 1.2, desired * 1.4].map(value => Math.max(maxWidth, Math.ceil(value))))];
  let best: Packing | undefined, bestScore = Infinity;
  for (const capacity of candidates) {
    let skyline = [{ x: 0, width: capacity + gap, y: 0 }];
    const at = new Map<string, { x: number; y: number }>();
    let width = 0, height = 0;
    for (const box of stable) {
      const occupied = box.width + gap;
      let x = 0, y = Infinity;
      for (const segment of skyline) {
        if (segment.x + occupied > capacity + gap + 1e-7) continue;
        const top = Math.max(...skyline.filter(item => item.x < segment.x + occupied && item.x + item.width > segment.x).map(item => item.y));
        if (top < y || top === y && segment.x < x) { x = segment.x; y = top; }
      }
      if (!Number.isFinite(y)) throw new Error('无法计算安全布局，未执行整理。');
      at.set(box.id, { x: round(x), y: round(y) });
      width = Math.max(width, x + box.width); height = Math.max(height, y + box.height);
      const end = x + occupied;
      const remaining = skyline.flatMap(item => {
        const right = item.x + item.width;
        if (right <= x || item.x >= end) return [item];
        return [...(item.x < x ? [{ ...item, width: x - item.x }] : []), ...(right > end ? [{ ...item, x: end, width: right - end }] : [])];
      });
      remaining.push({ x, width: occupied, y: y + box.height + gap });
      remaining.sort((a, b) => a.x - b.x);
      skyline = [];
      for (const segment of remaining) {
        const previous = skyline.at(-1);
        if (previous && previous.y === segment.y && Math.abs(previous.x + previous.width - segment.x) < 1e-7) previous.width += segment.width;
        else skyline.push(segment);
      }
    }
    const score = width * height * (1 + 0.12 * Math.abs(Math.log(Math.max(1, width) / Math.max(1, height) / 1.35)));
    if (score < bestScore) { bestScore = score; best = { at, width: round(width), height: round(height) }; }
  }
  return best!;
}

function changedPosition(node: Card, x: number, y: number): Card {
  x = round(x); y = round(y);
  return node.position.x === x && node.position.y === y ? node : { ...node, position: { x, y } };
}
function sizedGroup(node: Card, width: number, height: number): Card {
  width = Math.max(320, round(width)); height = Math.max(220, round(height));
  if (cardSize(node).width === width && cardSize(node).height === height && node.width === width && node.height === height && node.style?.width === width && node.style?.height === height) return node;
  return { ...node, width, height, measured: { ...node.measured, width, height }, style: { ...node.style, width, height } };
}

export function arrangeBoardNodes(nodes: Card[], options: Arrangement = {}): Card[] {
  const byId = validateBoard(nodes);
  if (!nodes.length) return nodes;
  const requested = options.ids === undefined ? new Set(nodes.filter(node => !node.parentId).map(node => node.id)) : new Set(options.ids);
  if ([...requested].some(id => !byId.has(id))) throw new Error('部分元素已变化，请重新选择后整理。');
  if (!requested.size) return nodes;
  const children = new Map<string | undefined, Card[]>();
  for (const node of nodes) children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]);
  const next = new Map(byId), affected = new Set<string>();
  const include = (id: string) => { affected.add(id); for (const child of children.get(id) ?? []) include(child.id); };
  requested.forEach(include);
  // Ancestors repack every child, so include their full subtrees to size sibling groups first.
  for (const id of [...affected]) { let parent = byId.get(id)?.parentId; while (parent) { affected.add(parent); parent = byId.get(parent)?.parentId; } }
  for (const root of children.get(undefined) ?? []) if (affected.has(root.id)) include(root.id);
  const arrangeGroup = (id: string) => {
    const group = next.get(id)!;
    const members = children.get(id) ?? [];
    for (const child of members) if (child.data.kind === 'group' && affected.has(child.id)) arrangeGroup(child.id);
    if (!affected.has(id)) return;
    if (!members.length) { next.set(id, sizedGroup(group, 320, 220)); return; }
    const block = pack(members.map(child => ({ id: child.id, ...cardSize(next.get(child.id)!) })), options);
    for (const child of members) { const at = block.at.get(child.id)!; next.set(child.id, changedPosition(next.get(child.id)!, PAD + at.x, HEADER + at.y)); }
    next.set(id, sizedGroup(group, block.width + PAD * 2, block.height + HEADER + PAD));
  };
  for (const root of children.get(undefined) ?? []) if (root.data.kind === 'group') arrangeGroup(root.id);
  const roots = (children.get(undefined) ?? []).filter(node => affected.has(node.id));
  const block = pack(roots.map(node => ({ id: node.id, ...cardSize(next.get(node.id)!) })), options);
  const origin = { x: Math.min(...roots.map(node => node.position.x)), y: Math.min(...roots.map(node => node.position.y)) };
  const obstacles = (children.get(undefined) ?? []).filter(node => !affected.has(node.id)).map(node => ({ ...node.position, ...cardSize(node) }));
  // A subset stays compact while avoiding stationary siblings; all-board layout has no obstacles.
  const overlaps = (x: number, y: number, obstacle: typeof obstacles[number]) => x < obstacle.x + obstacle.width + PAD && x + block.width + PAD > obstacle.x && y < obstacle.y + obstacle.height + PAD && y + block.height + PAD > obstacle.y;
  for (let i = 0; i <= obstacles.length; i++) {
    const hits = obstacles.filter(obstacle => overlaps(origin.x, origin.y, obstacle));
    if (!hits.length) break;
    const right = Math.max(...hits.map(box => box.x + box.width + PAD)), bottom = Math.max(...hits.map(box => box.y + box.height + PAD));
    if (right - origin.x <= bottom - origin.y) origin.x = right; else origin.y = bottom;
  }
  for (const root of roots) { const at = block.at.get(root.id)!; next.set(root.id, changedPosition(next.get(root.id)!, origin.x + at.x, origin.y + at.y)); }
  const result = nodes.map(node => next.get(node.id)!);
  return result.every((node, index) => node === nodes[index]) ? nodes : result;
}

function groupIdentity(key: string) {
  let hash = 2166136261;
  for (const char of key) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return `organized-${(hash >>> 0).toString(16)}`;
}

export function classifyBoardNodes(nodes: Card[], plan: Classification, { allowRegroup = false }: { allowRegroup?: boolean } = {}): Card[] {
  const original = validateBoard(nodes);
  if (!plan || !Array.isArray(plan.groups) || !plan.groups.length || plan.groups.length > 100) throw new Error('智能归类需要完整的分组关系。');
  const declarations = new Map<string, Classification['groups'][number]>();
  for (const group of plan.groups) {
    if (typeof group.id !== 'string' || declarations.has(group.id) || !Array.isArray(group.memberIds) || !group.memberIds.length || group.memberIds.some(id => typeof id !== 'string')) throw new Error('分组编号重复或成员为空，未执行归类。');
    if (group.id.startsWith('new:')) {
      if (!/^new:[a-zA-Z0-9_-]{1,80}$/u.test(group.id) || !group.title?.trim() || group.title.length > 120) throw new Error('新分组需要稳定编号和名称。');
    } else if (original.get(group.id)?.data.kind !== 'group') throw new Error('目标分组不存在，未执行归类。');
    declarations.set(group.id, group);
  }
  const aliases = new Map<string, string>(), additions: Card[] = [], renamed = new Map<string, string>();
  const resolve = (reference: string, path = new Set<string>()): string => {
    if (aliases.has(reference)) return aliases.get(reference)!;
    const declaration = declarations.get(reference);
    if (!declaration) { if (!original.has(reference)) throw new Error('分组成员已不存在，未执行归类。'); return reference; }
    if (!reference.startsWith('new:')) { aliases.set(reference, reference); return reference; }
    if (path.has(reference)) throw new Error('分组方案存在循环，未执行归类。');
    path.add(reference);
    const members = declaration.memberIds.map(id => resolve(id, path));
    path.delete(reference);
    const generatedId = groupIdentity(reference), sameKey = original.get(generatedId);
    if (sameKey && (sameKey.data.kind !== 'group' || sameKey.data.organizerKey !== reference)) throw new Error('分组编号冲突，未执行归类。');
    // Reuse the existing membership even when the model changes its temporary category key.
    const sameMembers = nodes.filter(node => node.data.kind === 'group').filter(node => {
      const children = nodes.filter(child => child.parentId === node.id).map(child => child.id);
      return children.length === members.length && children.every(id => members.includes(id));
    }).sort((a, b) => a.id.localeCompare(b.id))[0];
    const existing = sameKey ?? sameMembers, id = existing?.id ?? generatedId;
    if ([...aliases.values()].includes(id)) throw new Error('多个分类重复指向同一分组，未执行归类。');
    aliases.set(reference, id);
    if (!existing) additions.push({ id, type: 'group', position: { x: Math.min(0, ...nodes.filter(node => !node.parentId).map(node => node.position.x)), y: Math.min(0, ...nodes.filter(node => !node.parentId).map(node => node.position.y)) }, data: { kind: 'group', title: declaration.title!.trim(), content: '', source: 'ai', organizerKey: reference }, style: { width: 320, height: 220 } });
    else if (allowRegroup && declaration.title!.trim() !== existing.data.title) renamed.set(id, declaration.title!.trim());
    return id;
  };
  for (const group of plan.groups) resolve(group.id);
  if (new Set(aliases.values()).size !== aliases.size) throw new Error('多个分类重复指向同一分组，未执行归类。');
  const combined = [...nodes.map(node => renamed.has(node.id) ? { ...node, data: { ...node.data, title: renamed.get(node.id)! } } : node), ...additions], byId = new Map(combined.map(node => [node.id, node])), parents = new Map<string, string>();
  for (const group of plan.groups) {
    const target = aliases.get(group.id)!;
    for (const reference of group.memberIds) {
      const id = aliases.get(reference) ?? reference, member = byId.get(id);
      if (!member || parents.has(id) || target === id) throw new Error('分组成员缺失、重复或引用自身，未执行归类。');
      if (!allowRegroup && (member.parentId && member.parentId !== target || member.data.kind === 'group' && original.has(id) && member.parentId !== target)) throw new Error('这会改变原分组关系；请明确要求重新归类后再执行。');
      parents.set(id, target);
    }
  }
  let result = combined.map(node => parents.has(node.id) && node.parentId !== parents.get(node.id) ? { ...node, parentId: parents.get(node.id), extent: undefined, expandParent: false } : node);
  validateBoard(result);
  // Parent-first order is required by React Flow. Every existing ID/content/edge is retained.
  const lookup = new Map(result.map(node => [node.id, node])), ordered: Card[] = [], seen = new Set<string>();
  const visit = (node: Card) => { if (seen.has(node.id)) return; if (node.parentId) visit(lookup.get(node.parentId)!); seen.add(node.id); ordered.push(node); };
  result.forEach(visit);
  result = arrangeBoardNodes(ordered);
  return result.length === nodes.length && result.every((node, index) => node === nodes[index]) ? nodes : result;
}
