import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const source = process.env.SUO_TOOLBAR_SOURCE ?? fileURLToPath(new URL('../src', import.meta.url));
const { toolbarRect, panelDefaults, movePanel, TOOLBAR_HEIGHT } = await import(pathToFileURL(join(source, 'geometry.ts')));
test('old saved toolbar grows to fit the added control without mutating its saved rectangle', () => {
  const saved = { x: 20, y: 520, width: 56, height: 252 };
  const shown = toolbarRect(saved, 1280, 780);
  assert.equal(saved.height, 252);
  assert.equal(shown.height, TOOLBAR_HEIGHT);
  assert.equal(shown.x, saved.x);
  assert.ok(shown.y + shown.height <= 772);
  assert.equal(panelDefaults(1280, 780, true).toolbar.height, shown.height);
});
test('toolbar moves retain room for all controls and stay inside the stage', () => {
  const saved = { x: 20, y: 18, width: 56, height: 252 };
  for (const delta of [-2000, 0, 2000]) {
    const shown = movePanel(saved, delta, delta, 1280, 780, false, 'toolbar');
    assert.equal(shown.height, TOOLBAR_HEIGHT);
    assert.ok(shown.x >= 8 && shown.y >= 8 && shown.x + shown.width <= 1272 && shown.y + shown.height <= 772);
  }
});
test('small stage clamps the toolbar while taller custom layouts retain their size', () => {
  const saved = { x: 900, y: 720, width: 56, height: 390 };
  assert.equal(toolbarRect(saved, 1280, 780).height, 390);
  const shown = toolbarRect(saved, 380, 220);
  assert.equal(shown.height, 204);
  assert.ok(shown.x >= 8 && shown.y >= 8 && shown.x + shown.width <= 372 && shown.y + shown.height <= 212);
});
