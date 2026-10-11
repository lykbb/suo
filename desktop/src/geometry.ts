import type { PanelName, Rect, Card } from './types';
import { absoluteCardPosition, cardSize } from './grouping.ts';

export const TOOLBAR_HEIGHT = 330;
export const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
export function clampRect(rect: Rect, width: number, height: number, min = { width: 56, height: 56 }): Rect {
  const w = clamp(rect.width, Math.min(min.width, width - 16), width - 16);
  const h = clamp(rect.height, Math.min(min.height, height - 16), height - 16);
  return { x: clamp(rect.x, 8, Math.max(8, width - w - 8)), y: clamp(rect.y, 8, Math.max(8, height - h - 8)), width: w, height: h };
}
export function panelDefaults(width: number, height: number, showThread: boolean): Record<PanelName, Rect> {
  const threadWidth = width < 1050 ? 285 : 310;
  const available = width - (showThread ? threadWidth + 44 : 0);
  const composerWidth = Math.min(620, available - 110);
  return {
    composer: clampRect({ x: (available - composerWidth) / 2, y: height - 144, width: composerWidth, height: 120 }, width, height),
    thread: clampRect({ x: width - threadWidth - 24, y: 18, width: threadWidth, height: height - 88 }, width, height),
    reader: clampRect({ x: 96, y: 18, width: Math.max(340, available - 120), height: Math.max(220, height - 174) }, width, height),
    drawing: clampRect({ x: 96, y: 24, width: Math.min(920, Math.max(480, available - 132)), height: Math.min(640, Math.max(320, height - 178)) }, width, height),
    toolbar: clampRect({ x: 20, y: 18, width: 56, height: TOOLBAR_HEIGHT }, width, height),
  };
}
// Existing sessions can have a shorter saved toolbar. Fit the current controls without rewriting that saved layout.
export function toolbarRect(rect: Rect, width: number, height: number): Rect {
  return clampRect({ ...rect, height: Math.max(TOOLBAR_HEIGHT, rect.height) }, width, height, { width: 56, height: TOOLBAR_HEIGHT });
}
// On the home page the composer sits a little above the middle of the stage, wide and tall.
export function welcomeComposer(width: number, height: number): Rect {
  const w = Math.min(720, width - 64), h = 136;
  return { x: Math.round((width - w) / 2), y: Math.round(Math.max(232, height * 0.5 - h / 2 + 8)), width: w, height: h };
}
export function movePanel(rect: Rect, dx: number, dy: number, width: number, height: number, resize: boolean, name: PanelName): Rect {
  const next = resize ? { ...rect, width: rect.width + dx, height: rect.height + dy } : { ...rect, x: rect.x + dx, y: rect.y + dy };
  if (!resize) {
    for (const x of [8, width - next.width - 8]) if (Math.abs(next.x - x) < 12) next.x = x;
    for (const y of [8, height - next.height - 8]) if (Math.abs(next.y - y) < 12) next.y = y;
  }
  return clampRect(next, width, height, { width: name === 'toolbar' ? 56 : name === 'thread' ? 270 : name === 'drawing' ? 480 : 340, height: name === 'toolbar' ? TOOLBAR_HEIGHT : name === 'thread' ? 250 : name === 'drawing' ? 320 : 112 });
}
export type ResizeEdge = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
export function resizePanel(rect: Rect, dx: number, dy: number, width: number, height: number, edge: ResizeEdge, name: PanelName): Rect {
  const minWidth = Math.min(name === 'thread' ? 270 : name === 'drawing' ? 480 : 340, width - 16);
  const minHeight = Math.min(name === 'thread' ? 250 : name === 'drawing' ? 320 : 112, height - 16);
  let left = rect.x, top = rect.y, right = rect.x + rect.width, bottom = rect.y + rect.height;
  if (edge.includes('w')) left = clamp(left + dx, 8, right - minWidth);
  if (edge.includes('e')) right = clamp(right + dx, left + minWidth, width - 8);
  if (edge.includes('n')) top = clamp(top + dy, 8, bottom - minHeight);
  if (edge.includes('s')) bottom = clamp(bottom + dy, top + minHeight, height - 8);
  return { x: left, y: top, width: right - left, height: bottom - top };
}
export function groupCards(nodes: Card[], groupId: string): Card[] {
  const selected = nodes.filter(node => node.selected && !node.parentId && node.data.kind !== 'group');
  if (selected.length < 2) return nodes;
  const x = Math.min(...selected.map(node => node.position.x)) - 24;
  const y = Math.min(...selected.map(node => node.position.y)) - 44;
  const right = Math.max(...selected.map(node => node.position.x + cardSize(node).width));
  const bottom = Math.max(...selected.map(node => node.position.y + cardSize(node).height));
  const group: Card = { id: groupId, type: 'group', position: { x, y }, style: { width: Math.max(320, right - x + 24), height: Math.max(220, bottom - y + 24) }, data: { kind: 'group', title: '新分组', content: '' }, selected: true };
  const ids = new Set(selected.map(node => node.id));
  return [group, ...nodes.map(node => ids.has(node.id) ? { ...node, parentId: groupId, position: { x: node.position.x - x, y: node.position.y - y }, selected: false } : node)];
}
export function ungroupCards(nodes: Card[], groupId: string): Card[] {
  const group = nodes.find(node => node.id === groupId && node.data.kind === 'group');
  if (!group) return nodes;
  return nodes.filter(node => node.id !== groupId).map(node => {
    if (node.parentId !== groupId) return node;
    const at = absoluteCardPosition(nodes, node);
    const parent = group.parentId && nodes.find(item => item.id === group.parentId);
    const base = parent ? absoluteCardPosition(nodes, parent) : { x: 0, y: 0 };
    return { ...node, parentId: group.parentId, extent: undefined, expandParent: false, position: { x: at.x - base.x, y: at.y - base.y }, selected: !!node.selected || !!group.selected };
  });
}
export function cleanNodes(nodes: Card[]): Card[] {
  return nodes.map(({ dragging, resizing, measured, ...node }) => ({ ...node, selected: false }));
}
// Every card as an absolute box on the board (children of a group are stored relative to it).
export function nodeBoxes(nodes: Card[]): Rect[] {
  return nodes.map(node => ({ ...absoluteCardPosition(nodes, node), ...cardSize(node) }));
}

// The top-left corner closest to `start` where a width×height block overlaps no card (with a gap).
export function freeSpot(nodes: Card[], start: { x: number; y: number }, width: number, height: number, gap = 24) {
  const boxes = nodeBoxes(nodes);
  const clear = (x: number, y: number) => boxes.every(box => x + width + gap <= box.x || box.x + box.width + gap <= x || y + height + gap <= box.y || box.y + box.height + gap <= y);
  const offsets: { x: number; y: number }[] = [];
  for (let row = -6; row <= 6; row++) for (let col = -6; col <= 6; col++) offsets.push({ x: col * 120, y: row * 120 });
  offsets.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
  const found = offsets.find(offset => clear(start.x + offset.x, start.y + offset.y));
  if (found) return { x: start.x + found.x, y: start.y + found.y };
  // Crowded around the start: go just past the right edge of everything.
  return { x: Math.max(...boxes.map(box => box.x + box.width)) + gap * 2, y: start.y };
}

// The part of the stage the floating panels leave uncovered, so framing the board and placing new
// cards follow the panels wherever the user has moved or resized them.
export function openArea(width: number, height: number, thread: boolean, panels: Partial<Record<PanelName, Rect>> = {}): Rect {
  const defaults = panelDefaults(width, height, thread);
  const at = (name: PanelName) => clampRect(panels[name] ?? defaults[name], width, height);
  let left = 0, right = width, top = 16, bottom = height;
  for (const name of thread ? ['toolbar', 'thread'] as const : ['toolbar'] as const) {
    const rect = at(name);
    if (rect.x + rect.width / 2 < width / 2) left = Math.max(left, rect.x + rect.width + 16);
    else right = Math.min(right, rect.x - 16);
  }
  const composer = at('composer');
  if (composer.y + composer.height / 2 > height / 2) bottom = Math.min(bottom, composer.y - 16);
  else top = Math.max(top, composer.y + composer.height + 16);
  // Panels moved into the middle leave no room; use the whole stage then.
  if (right - left < 240) { left = 0; right = width; }
  if (bottom - top < 160) { top = 16; bottom = height; }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function boardViewport(nodes: Card[], width: number, height: number, thread: boolean, panels: Partial<Record<PanelName, Rect>> = {}) {
  if (!nodes.length) return { x: 0, y: 0, zoom: 1 };
  const boxes = nodeBoxes(nodes);
  const left = Math.min(...boxes.map(box => box.x)), top = Math.min(...boxes.map(box => box.y));
  const right = Math.max(...boxes.map(box => box.x + box.width)), bottom = Math.max(...boxes.map(box => box.y + box.height));
  const area = openArea(width, height, thread, panels), pad = 12;
  const zoom = clamp(Math.min((area.width - pad * 2) / (right - left), (area.height - pad * 2) / (bottom - top)), 0.2, 1);
  return { x: area.x + (area.width - (right - left) * zoom) / 2 - left * zoom, y: area.y + (area.height - (bottom - top) * zoom) / 2 - top * zoom, zoom };
}

export function imageGeometry(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const ratio = width / height;
  const scale = Math.min(1, 480 / width, 420 / height);
  const minimum = Math.min(1, 64 / Math.max(width, height));
  const size = Math.max(scale, minimum);
  return { ratio, width: width * size, height: height * size, minWidth: 64 * Math.min(1, ratio), minHeight: 64 / Math.max(1, ratio) };
}
