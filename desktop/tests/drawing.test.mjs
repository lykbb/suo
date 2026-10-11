import test from 'node:test';
import assert from 'node:assert/strict';
import { withDrawingCard, visibleDrawingElements } from '../src/drawingModel.ts';
import { orderPanels, panelZ } from '../src/layers.ts';
import { panelDefaults, movePanel } from '../src/geometry.ts';
import { WorkspaceStore } from '../bridge/store.mjs';
import { createTestDirectory } from './helpers/test-data.mjs';

const workspace = () => ({ id: 'workspace', nodes: [], panels: {}, drawing: { elements: [{ id: 'shape', type: 'rectangle', isDeleted: false }], appState: {}, files: {} } });
test('existing scenes gain one preview; reopening preserves card position, size and pinning', () => {
  const first = withDrawingCard(workspace(), { x: 40, y: 60 });
  assert.equal(first.nodes.length, 1);
  const custom = { ...first, nodes: first.nodes.map(node => ({ ...node, position: { x: 91, y: 73 }, style: { width: 811, height: 620 }, data: { ...node.data, pinned: true } })) };
  assert.equal(withDrawingCard(custom, { x: 0, y: 0 }, true), custom);
  assert.equal(withDrawingCard(first), first);
});
test('blank or removed scenes do not recreate cards until the drawing entry is opened', () => {
  const empty = { ...workspace(), drawing: { elements: [{ id: 'deleted', isDeleted: true }], appState: {}, files: {} } };
  assert.equal(withDrawingCard(empty), empty);
  assert.equal(visibleDrawingElements(empty.drawing).length, 0);
  const hidden = { ...workspace(), drawingCardHidden: true };
  assert.equal(withDrawingCard(hidden), hidden);
  const reopened = withDrawingCard(hidden, undefined, true);
  assert.equal(reopened.nodes.length, 1);
  assert.equal(reopened.drawingCardHidden, false);
});
test('focused or pinned editor remains below chat and title menus; editor can move and resize', () => {
  for (const pinned of [false, true]) {
    const layers = orderPanels(orderPanels({}, 'composer'), 'drawing', pinned);
    for (const name of ['composer', 'thread', 'reader', 'toolbar']) assert.ok(panelZ(layers, 'drawing') < panelZ(layers, name));
    assert.ok(panelZ(layers, 'drawing') < 50);
  }
  const rect = panelDefaults(1280, 668, true).drawing;
  assert.notDeepEqual(movePanel(rect, 70, 40, 1280, 668, false, 'drawing'), rect);
  const small = movePanel(rect, -2000, -2000, 1280, 668, true, 'drawing');
  assert.equal(small.width, 480); assert.equal(small.height, 320);
});
test('native workspace storage retains scene, preview card and editor geometry together', async () => {
  const dir = await createTestDirectory('sketch-window-');
  const store = new WorkspaceStore(dir), first = await store.create();
  const next = withDrawingCard({ ...first, drawing: workspace().drawing, panels: { drawing: { x: 96, y: 24, width: 790, height: 490 } } });
  await store.save(next, first.version);
  const loaded = await store.load(first.id);
  assert.equal(loaded.nodes[0].data.kind, 'drawing');
  assert.deepEqual(loaded.drawing, next.drawing);
  assert.deepEqual(loaded.panels.drawing, next.panels.drawing);
  assert.equal(withDrawingCard(loaded), loaded);
});
