import test from 'node:test';
import assert from 'node:assert/strict';
import { freeSpot } from '../src/geometry.ts';

const card = (id, x, y, width = 258, height = 174, extra = {}) => ({ id, position: { x, y }, style: { width, height }, data: { kind: 'note' }, ...extra });
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('an empty board keeps the requested spot', () => {
  assert.deepEqual(freeSpot([], { x: 100, y: 80 }, 380, 280), { x: 100, y: 80 });
});

test('new cards land next to existing ones instead of on top of them', () => {
  const nodes = [card('a', 100, 80, 300, 200), card('b', 420, 80, 300, 200)];
  const at = freeSpot(nodes, { x: 120, y: 100 }, 380, 280);
  for (const node of nodes) assert(!overlaps({ ...at, width: 380, height: 280 }, { ...node.position, ...node.style }));
  assert(Math.hypot(at.x - 120, at.y - 100) < 700, 'stays near where it was asked for');
});

test('cards inside a group count at their absolute position', () => {
  const nodes = [card('g', 500, 500, 400, 300, { type: 'group' }), card('c', 20, 40, 258, 174, { parentId: 'g' })];
  const at = freeSpot(nodes, { x: 520, y: 540 }, 200, 100);
  assert(!overlaps({ ...at, width: 200, height: 100 }, { x: 520, y: 540, width: 258, height: 174 }));
});
