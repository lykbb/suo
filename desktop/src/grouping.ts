import type { Card, Rect } from './types';

const positive = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
const numericStyle = (value: unknown) => typeof value === 'number' ? value : typeof value === 'string' && /^\d+(\.\d+)?(px)?$/.test(value) ? parseFloat(value) : undefined;
export function cardSize(node: Card) {
  return {
    width: positive(node.measured?.width, positive(node.width, positive(numericStyle(node.style?.width), node.data.kind === 'group' ? 320 : 258))),
    height: positive(node.measured?.height, positive(node.height, positive(numericStyle(node.style?.height), node.data.kind === 'group' ? 220 : 174))),
  };
}

export function absoluteCardPosition(nodes: Card[], node: Card) {
  const byId = new Map(nodes.map(item => [item.id, item]));
  let x = node.position.x, y = node.position.y, parentId = node.parentId;
  const visited = new Set([node.id]);
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    x += parent.position.x; y += parent.position.y; parentId = parent.parentId;
  }
  return { x, y };
}

function ancestors(nodes: Card[], node: Card) {
  const byId = new Map(nodes.map(item => [item.id, item]));
  const ids: string[] = [], visited = new Set([node.id]);
  let parentId = node.parentId;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId); ids.push(parentId); parentId = byId.get(parentId)?.parentId;
  }
  return ids;
}

// React Flow requires parents before their children, including after joining an older group.
function parentsFirst(nodes: Card[]) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const output: Card[] = [], seen = new Set<string>();
  const visit = (node: Card) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    const parent = node.parentId && byId.get(node.parentId);
    if (parent) visit(parent);
    output.push(node);
  };
  nodes.forEach(visit);
  return output;
}

function sized(node: Card, width: number, height: number): Card {
  return { ...node, width, height, measured: { ...node.measured, width, height }, style: { ...node.style, width, height } };
}

export type GroupSelectionPlan = { kind: 'create'; cardIds: string[] } | { kind: 'join'; groupId: string; cardIds: string[] } | { kind: 'ungroup'; groupId: string } | { kind: 'none'; reason: 'empty' | 'multiple-groups' | 'too-few' };
export function groupSelectionPlan(nodes: Card[]): GroupSelectionPlan {
  const selected = nodes.filter(node => node.selected && node.selectable !== false);
  if (!selected.length) return { kind: 'none', reason: 'empty' };
  const byId = new Map(nodes.map(node => [node.id, node]));
  const groups = new Set<string>();
  for (const node of selected) {
    if (node.data.kind === 'group') groups.add(node.id);
    else {
      const parent = node.parentId && byId.get(node.parentId);
      if (parent && parent.data.kind === 'group') groups.add(parent.id);
    }
  }
  if (groups.size > 1) return { kind: 'none', reason: 'multiple-groups' };
  if (groups.size === 1) {
    const groupId = [...groups][0];
    const cards = selected.filter(node => node.data.kind !== 'group' && node.parentId !== groupId && !node.parentId);
    return cards.length ? { kind: 'join', groupId, cardIds: cards.map(node => node.id) } : { kind: 'ungroup', groupId };
  }
  const cardIds = selected.filter(node => !node.parentId && node.data.kind !== 'group').map(node => node.id);
  return cardIds.length >= 2 ? { kind: 'create', cardIds } : { kind: 'none', reason: 'too-few' };
}

export function selectedGroupIds(nodes: Card[]) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  return [...new Set(nodes.filter(node => node.selected).flatMap(node => node.data.kind === 'group' ? [node.id] : node.parentId && byId.get(node.parentId)?.data.kind === 'group' ? [node.parentId] : []))];
}

// Expand the container without moving any existing or incoming card on the board.
export function addCardsToGroup(nodes: Card[], groupId: string, cardIds: string[]): Card[] {
  const group = nodes.find(node => node.id === groupId && node.data.kind === 'group');
  if (!group) return nodes;
  const ids = new Set(cardIds), incoming = nodes.filter(node => ids.has(node.id) && node.data.kind !== 'group');
  if (!incoming.length) return nodes;
  const old = { ...absoluteCardPosition(nodes, group), ...cardSize(group) };
  const boxes = incoming.map(node => ({ ...absoluteCardPosition(nodes, node), ...cardSize(node) }));
  const x = Math.min(old.x, ...boxes.map(box => box.x - 24));
  const y = Math.min(old.y, ...boxes.map(box => box.y - 44));
  const right = Math.max(old.x + old.width, ...boxes.map(box => box.x + box.width + 24));
  const bottom = Math.max(old.y + old.height, ...boxes.map(box => box.y + box.height + 24));
  if (x === old.x && y === old.y && right === old.x + old.width && bottom === old.y + old.height && incoming.every(node => node.parentId === groupId)) return nodes;
  const parent = group.parentId && nodes.find(node => node.id === group.parentId);
  const parentOffset = parent ? absoluteCardPosition(nodes, parent) : { x: 0, y: 0 };
  return parentsFirst(nodes.map(node => {
    if (node.id === groupId) return sized({ ...node, position: { x: x - parentOffset.x, y: y - parentOffset.y } }, right - x, bottom - y);
    if (node.parentId !== groupId && !ids.has(node.id)) return node;
    const at = absoluteCardPosition(nodes, node);
    return { ...node, parentId: groupId, extent: undefined, expandParent: false, position: { x: at.x - x, y: at.y - y } };
  }));
}

export function reparentDraggedCards(nodes: Card[], draggedIds: string[]): Card[] {
  const moving = new Set(draggedIds);
  const draggedGroups = new Set(nodes.filter(node => moving.has(node.id) && node.data.kind === 'group').map(node => node.id));
  const groups = nodes.filter(node => node.data.kind === 'group' && !moving.has(node.id)).map(node => ({ node, box: { ...absoluteCardPosition(nodes, node), ...cardSize(node) } }));
  const joins = new Map<string, string[]>();
  let next = nodes.map(node => {
    if (!moving.has(node.id) || node.data.kind === 'group' || ancestors(nodes, node).some(id => draggedGroups.has(id))) return node;
    if (node.parentId && !nodes.some(parent => parent.id === node.parentId && parent.data.kind === 'group')) return node;
    const at = absoluteCardPosition(nodes, node), size = cardSize(node);
    const center = { x: at.x + size.width / 2, y: at.y + size.height / 2 };
    const targets = groups.filter(({ box }) => center.x >= box.x && center.x <= box.x + box.width && center.y >= box.y + 44 && center.y <= box.y + box.height);
    targets.sort((a, b) => Number(b.node.id === node.parentId) - Number(a.node.id === node.parentId) || a.box.width * a.box.height - b.box.width * b.box.height || Number(b.node.data.layerOrder ?? 0) - Number(a.node.data.layerOrder ?? 0) || a.node.id.localeCompare(b.node.id));
    const target = targets[0]?.node;
    if (target) { joins.set(target.id, [...(joins.get(target.id) ?? []), node.id]); return node; }
    return node.parentId ? { ...node, parentId: undefined, extent: undefined, expandParent: false, position: at } : node;
  });
  for (const [groupId, ids] of joins) next = addCardsToGroup(next, groupId, ids);
  return next.every((node, index) => node === nodes[index]) ? nodes : next;
}

function cardMinimum(node: Card) {
  if (node.data.kind === 'group') return { width: 320, height: 220 };
  if (node.data.asset?.kind === 'image') {
    const ratio = positive(node.data.imageAspectRatio, 1);
    return { width: 64 * Math.min(1, ratio), height: 64 / Math.max(1, ratio) };
  }
  return node.data.kind === 'drawing' ? { width: 380, height: 240 } : node.data.asset ? { width: 250, height: 180 } : { width: 200, height: 130 };
}

export type GroupResizeSnapshot = { groupId: string; rect: Rect; nodes: Card[]; minimum: { width: number; height: number } };
export function captureGroupResize(nodes: Card[], groupId: string): GroupResizeSnapshot | null {
  const group = nodes.find(node => node.id === groupId && node.data.kind === 'group');
  if (!group) return null;
  const rect = { ...group.position, ...cardSize(group) }, members = nodes.filter(node => node.id === groupId || ancestors(nodes, node).includes(groupId));
  const scaleX = Math.max(320 / rect.width, ...members.filter(node => node.id !== groupId).map(node => cardMinimum(node).width / cardSize(node).width));
  const scaleY = Math.max(220 / rect.height, ...members.filter(node => node.id !== groupId).map(node => cardMinimum(node).height / cardSize(node).height));
  return { groupId, rect, nodes: members.map(node => ({ ...node, position: { ...node.position }, style: { ...node.style }, measured: node.measured && { ...node.measured } })), minimum: { width: rect.width * scaleX, height: rect.height * scaleY } };
}

export function groupResizeMinimum(nodes: Card[], id: string) {
  const minimum = captureGroupResize(nodes, id)?.minimum ?? { width: 320, height: 220 };
  return { width: Math.ceil((minimum.width - 1e-8) * 1000) / 1000, height: Math.ceil((minimum.height - 1e-8) * 1000) / 1000 };
}

// Every frame derives from the original geometry, so repeated frames cannot accumulate rounding.
export function resizeGroupCards(nodes: Card[], snapshot: GroupResizeSnapshot, desired: Rect, resizing = true): Card[] {
  if (![desired.x, desired.y, desired.width, desired.height].every(Number.isFinite)) return nodes;
  const width = Math.max(snapshot.minimum.width, desired.width), height = Math.max(snapshot.minimum.height, desired.height);
  const x = desired.x !== snapshot.rect.x ? snapshot.rect.x + snapshot.rect.width - width : desired.x;
  const y = desired.y !== snapshot.rect.y ? snapshot.rect.y + snapshot.rect.height - height : desired.y;
  const scaleX = width / snapshot.rect.width, scaleY = height / snapshot.rect.height;
  const originals = new Map(snapshot.nodes.map(node => [node.id, node]));
  return nodes.map(node => {
    const original = originals.get(node.id);
    if (!original) return node;
    const size = cardSize(original);
    return sized({ ...node, resizing: node.id === snapshot.groupId && resizing, position: node.id === snapshot.groupId ? { x, y } : { x: original.position.x * scaleX, y: original.position.y * scaleY } }, node.id === snapshot.groupId ? width : size.width * scaleX, node.id === snapshot.groupId ? height : size.height * scaleY);
  });
}

export function restoreGroupResize(nodes: Card[], snapshot: GroupResizeSnapshot): Card[] {
  const originals = new Map(snapshot.nodes.map(node => [node.id, node]));
  return nodes.map(node => {
    const original = originals.get(node.id);
    return original ? { ...node, position: { ...original.position }, width: original.width, height: original.height, measured: original.measured && { ...original.measured }, style: { ...node.style, width: original.style?.width, height: original.style?.height }, resizing: false } : node;
  });
}
