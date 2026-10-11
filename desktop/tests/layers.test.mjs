import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDirectory } from './helpers/test-data.mjs';
import { orderCards, orderPanels, panelZ } from '../src/layers.ts';
import { validReaderMessage, wheelPixels } from '../src/readerMessage.ts';
import { WorkspaceStore } from '../bridge/store.mjs';

const card = (id, pinned = false) => ({ id, type: 'card', position: { x: 10, y: 10 }, data: { kind: 'note', title: id, content: '', pinned } });
test('pinned cards stay above later focused ordinary cards', () => {
  let cards = orderCards([card('a'), card('b'), card('c')], 'a', true);
  cards = orderCards(cards, 'b');
  assert.ok(cards[0].zIndex > cards[1].zIndex);
  cards = orderCards(cards, 'c', true);
  assert.ok(cards[2].zIndex > cards[0].zIndex);
  cards = orderCards(cards, 'a');
  assert.ok(cards[0].zIndex > cards[2].zIndex);
});
test('unpin restores ordinary stacking and old invalid orders are normalized', () => {
  const cards = orderCards([{ ...card('a', true), data: { ...card('a', true).data, layerOrder: Infinity } }, card('b', true)], 'a', false);
  assert.ok(cards[0].zIndex < cards[1].zIndex);
  assert.ok(Number.isFinite(cards[0].data.layerOrder));
  assert.deepEqual(orderCards(cards), cards);
  assert.equal(orderCards([{ ...card('g'), data: { kind: 'group' } }])[0].zIndex, -1);
});
test('panel pinning stays below menus and survives focus of other panels', () => {
  let layers = orderPanels({}, 'composer', true);
  layers = orderPanels(layers, 'reader');
  assert.ok(panelZ(layers, 'composer') > panelZ(layers, 'reader'));
  assert.ok(panelZ(layers, 'composer') < 50);
  layers = orderPanels(layers, 'composer', false);
  assert.ok(panelZ(layers, 'composer') < 30);
});
test('reader bridge rejects forged, non-finite and malformed messages', () => {
  const activate = { channel: 'channel', type: 'reader-activate', ctrlKey: false, metaKey: false, shiftKey: false };
  assert.equal(validReaderMessage(activate, 'channel'), true);
  assert.equal(validReaderMessage(activate, 'another'), false);
  assert.equal(validReaderMessage({ ...activate, type: 'reader-zoom', x: 10, y: 10, delta: NaN, deltaMode: 0 }, 'channel'), false);
  assert.equal(validReaderMessage({ ...activate, type: 'reader-zoom', x: 10, y: 10, delta: 20, deltaMode: 0 }, 'channel'), true);
  assert.equal(validReaderMessage({ ...activate, ctrlKey: 'yes' }, 'channel'), false);
  assert.equal(wheelPixels(2, 1), 32);
  assert.equal(wheelPixels(1, 2), 200);
});
test('drawing, pinned layers and custom panels round-trip through versioned native storage', async () => {
  const dir = await createTestDirectory('free-panels-');
  const store = new WorkspaceStore(dir), first = await store.create();
  const next = await store.save({ ...first, nodes: orderCards([card('pinned')], 'pinned', true),
    panelLayers: orderPanels({}, 'thread', true), panels: { composer: { x: 41, y: 72, width: 610, height: 140 } },
    drawing: { elements: [{ id: 'rectangle', type: 'rectangle' }], appState: { zoom: { value: 1 } }, files: {} },
  }, first.version);
  const loaded = await store.load(first.id);
  assert.deepEqual(loaded.panelLayers, next.panelLayers);
  assert.deepEqual(loaded.panels, next.panels);
  assert.deepEqual(loaded.drawing, next.drawing);
  assert.equal(loaded.nodes[0].data.pinned, true);
  await assert.rejects(store.save(loaded, first.version), /更新|冲突/);
});
