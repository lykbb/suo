import type { Edge } from '@xyflow/react';
import type { Card } from './types';

// What is on the board, sent with every message so Suo knows the cards without reading the board
// each turn: the number, title, kind and group of each card, the groups and the lines. No text or
// positions; board_read gives those when a task needs them. On a large board the selected and the
// newest cards are listed, with how many are left out.
export function boardOutline(nodes: Card[], edges: Edge[], limit = 50) {
  const cards = nodes.filter(node => node.data.kind !== 'group'), groups = nodes.filter(node => node.data.kind === 'group');
  if (!cards.length && !groups.length) return '画布是空的。';
  const titleOf = new Map(nodes.map(node => [node.id, node.data.title || '未命名']));
  const kind = (node: Card) => node.data.asset ? '资料' : node.data.kind === 'document' ? '文档' : node.data.kind === 'drawing' ? '草图' : '便签';
  const listed = cards.length <= limit ? cards : [...cards.filter(node => node.selected), ...cards.filter(node => !node.selected).reverse()].slice(0, limit);
  const lines = [`共 ${cards.length} 张卡片、${groups.length} 个分组、${edges.length} 条连线${listed.length < cards.length ? `；卡片较多，只列出选中的和最新的 ${listed.length} 张` : ''}。`];
  for (const node of listed) {
    const notes = [kind(node), node.parentId ? `在分组「${titleOf.get(node.parentId) ?? '未命名'}」里` : '', node.selected ? '已选中' : ''];
    lines.push(`- [${node.id}] ${titleOf.get(node.id)}（${notes.filter(Boolean).join('，')}）`);
  }
  if (groups.length) lines.push('分组：', ...groups.slice(0, 30).map(node => `- [${node.id}] ${titleOf.get(node.id)}`));
  if (edges.length) lines.push('连线（箭头表示方向，括号里是关系）：', ...edges.slice(0, 60).map(edge =>
    `- [${edge.source}] → [${edge.target}]${typeof edge.label === 'string' && edge.label.trim() ? `（${edge.label.trim()}）` : ''}`));
  if (groups.length > 30 || edges.length > 60) lines.push('[分组或连线较多，没有全部列出，需要时用 board_read 查看。]');
  return lines.join('\n');
}
