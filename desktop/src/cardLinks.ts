import type { Edge } from '@xyflow/react';
import type { Card } from './types';

// Relations people draw between cards, offered when connecting two of them.
export const RELATIONS = ['导致', '依赖', '支持', '反驳', '拆解为', '验证'];

// When the user asks about some cards, the cards linked to them come along, with how they relate,
// so "follow this line" works without selecting everything. Groups and drawings are left out.
export function linkedContext(nodes: Card[], edges: Edge[], selectedIds: string[], limit = 8) {
  const byId = new Map(nodes.map(node => [node.id, node])), chosen = new Set(selectedIds);
  const usable = (node?: Card) => !!node && node.data.kind !== 'group' && node.data.kind !== 'drawing';
  const related: Card[] = [];
  for (const edge of edges) {
    const other = chosen.has(edge.source) ? edge.target : chosen.has(edge.target) ? edge.source : '';
    const node = byId.get(other);
    if (other && !chosen.has(other) && usable(node) && !related.includes(node!) && related.length < limit) related.push(node!);
  }
  const shown = new Set([...selectedIds, ...related.map(node => node.id)]);
  const title = (id: string) => `「${byId.get(id)?.data.title || '未命名卡片'}」`;
  const relations = edges.filter(edge => shown.has(edge.source) && shown.has(edge.target) && edge.source !== edge.target)
    .map(edge => `${title(edge.source)} → ${title(edge.target)}${typeof edge.label === 'string' && edge.label.trim() ? `（${edge.label.trim()}）` : ''}`);
  return { related, relations };
}

// Where a connection leaves and enters: the facing sides of the two cards, at the middle of each
// side, where the card's connection dots sit. A dot takes any number of lines, in and out. Side by
// side (even far up or down) a line runs across, right to left as before; stacked, it runs bottom to
// top. A line back the other way takes the same route, so a two-way link reads as one line with an
// arrow at each end, and no line loops around a card.
export type Side = 'left' | 'right' | 'top' | 'bottom';
type Rect = { x: number; y: number; width: number; height: number };
const point = (box: Rect, side: Side) => side === 'left' ? { x: box.x, y: box.y + box.height / 2 } : side === 'right' ? { x: box.x + box.width, y: box.y + box.height / 2 }
  : side === 'top' ? { x: box.x + box.width / 2, y: box.y } : { x: box.x + box.width / 2, y: box.y + box.height };
export function facingSides(source: Rect, target: Rect) {
  const route = (from: Side, to: Side) => ({ from, to, start: point(source, from), end: point(target, to) });
  if (target.x >= source.x + source.width) return route('right', 'left');
  if (source.x >= target.x + target.width) return route('left', 'right');
  if (target.y >= source.y + source.height) return route('bottom', 'top');
  if (source.y >= target.y + target.height) return route('top', 'bottom');
  // Overlapping cards: across, toward the side the target's middle lies on.
  return target.x + target.width / 2 >= source.x + source.width / 2 ? route('right', 'left') : route('left', 'right');
}

// Manual edges keep stable port IDs; older and automatically created edges still face each other.
const isSide = (value: unknown): value is Side => value === 'left' || value === 'right' || value === 'top' || value === 'bottom';
export function connectionSides(source: Rect, target: Rect, sourceHandle?: string | null, targetHandle?: string | null) {
  const automatic = facingSides(source, target);
  const from = isSide(sourceHandle) ? sourceHandle : automatic.from;
  const to = isSide(targetHandle) ? targetHandle : automatic.to;
  return { from, to, start: point(source, from), end: point(target, to) };
}

// Offset the reverse label only when both directions name the same pair of ports.
export function lowerLabelEdges(edges: Edge[]) {
  const key = (source: string, from: string | null | undefined, target: string, to: string | null | undefined) => JSON.stringify([source, from ?? null, target, to ?? null]);
  const labelled = new Set(edges.filter(edge => edge.label).map(edge => key(edge.source, edge.sourceHandle, edge.target, edge.targetHandle)));
  return new Set(edges.filter(edge => edge.label && edge.source > edge.target && labelled.has(key(edge.target, edge.targetHandle, edge.source, edge.sourceHandle))).map(edge => edge.id));
}

// A node pair can have several lines. An ambiguous request never removes any of them.
export function disconnectEdges(edges: Edge[], { edgeId, from, to, all = false }: { edgeId?: string; from?: string; to?: string; all?: boolean }) {
  if (edgeId) {
    const chosen = edges.find(edge => edge.id === edgeId);
    if (!chosen) throw new Error('找不到指定的连线，请重新查看画布');
    if ((from && chosen.source !== from && chosen.target !== from) || (to && chosen.source !== to && chosen.target !== to)) throw new Error('连线编号与指定卡片不一致');
    return edges.filter(edge => edge.id !== edgeId);
  }
  if (!from || !to) throw new Error('unlink 需要连线编号 edgeId，或 from、to 卡片编号');
  const matched = edges.filter(edge => (edge.source === from && edge.target === to) || (edge.source === to && edge.target === from));
  if (!matched.length) throw new Error('这两张卡片之间没有连线');
  if (matched.length > 1 && !all) {
    const choices = matched.map(edge => ({ id: edge.id, from: edge.source, to: edge.target, sourceHandle: edge.sourceHandle ?? null, targetHandle: edge.targetHandle ?? null, label: typeof edge.label === 'string' ? edge.label : '' }));
    throw new Error(`[MULTIPLE_CONNECTIONS] 这两张卡片之间有 ${matched.length} 条连线，请先确认要删除哪条，再用 edgeId 精确删除；仅当用户明确要求全部断开时使用 all:true。可选连线：${JSON.stringify(choices)}`);
  }
  const removed = new Set(matched.map(edge => edge.id));
  return edges.filter(edge => !removed.has(edge.id));
}
