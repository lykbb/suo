import test from 'node:test';
import assert from 'node:assert/strict';
import { clampRect, panelDefaults, movePanel, groupCards, ungroupCards, boardViewport, openArea } from '../src/geometry.ts';

test('panel geometry stays inside the window and snaps to edges', () => {
  const rect = { x: 20, y: 20, width: 400, height: 150 };
  assert.equal(movePanel(rect, -100, -100, 1000, 700, false, 'composer').x, 8);
  assert.equal(movePanel(rect, 1000, 1000, 1000, 700, false, 'composer').y, 542);
  assert.equal(movePanel(rect, 569, 0, 1000, 700, false, 'composer').x, 592);
  const result = movePanel(rect, 2000, 2000, 1000, 700, true, 'composer');
  assert.ok(result.x + result.width <= 992 && result.y + result.height <= 692);
  const defaults = panelDefaults(820, 560, true);
  for (const value of Object.values(defaults)) assert.deepEqual(clampRect(value, 820, 560), value);
});
test('group and ungroup preserve absolute card positions', () => {
  const cards = [
    { id: 'a', position: { x: 100, y: 80 }, style: { width: 250, height: 160 }, data: { kind: 'note' }, selected: true },
    { id: 'b', position: { x: 400, y: 220 }, style: { width: 250, height: 160 }, data: { kind: 'note' }, selected: true },
  ];
  const grouped = groupCards(cards, 'g');
  assert.equal(grouped[0].data.kind, 'group');
  assert.equal(grouped[1].parentId, 'g');
  const restored = ungroupCards(grouped, 'g');
  assert.deepEqual(restored.map(card => card.position), cards.map(card => card.position));
});
test('fit keeps normal cards out from behind composer and conversation panel', () => {
  const cards = [
    { id: 'a', position: { x: 100, y: 80 }, style: { width: 250, height: 160 }, data: { kind: 'note' } },
    { id: 'b', position: { x: 400, y: 220 }, style: { width: 250, height: 160 }, data: { kind: 'note' } },
  ];
  const viewport = boardViewport(cards, 1280, 780, true);
  for (const card of cards) {
    const right = viewport.x + (card.position.x + card.style.width) * viewport.zoom;
    const bottom = viewport.y + (card.position.y + card.style.height) * viewport.zoom;
    assert.ok(right < 930 && bottom < 618);
  }
});
test('framing follows the panels where the user moved them', () => {
  const cards = [{ id: 'a', position: { x: 0, y: 0 }, style: { width: 600, height: 500 }, data: { kind: 'note' } }];
  // Composer moved to the top and conversation to the left: the cards go below and to the right of them.
  const panels = { composer: { x: 400, y: 10, width: 500, height: 120 }, thread: { x: 10, y: 150, width: 300, height: 600 } };
  const area = openArea(1280, 780, true, panels);
  assert.deepEqual([area.x, area.y], [326, 146]);
  const view = boardViewport(cards, 1280, 780, true, panels);
  assert.ok(view.x >= 326 && view.y >= 146 && view.y + 500 * view.zoom <= 780);
  // Panels dragged into the middle leave no room; the whole stage is used instead of nothing.
  const blocked = openArea(1280, 780, false, { composer: { x: 300, y: 150, width: 600, height: 500 } });
  assert.ok(blocked.height >= 600);
});
