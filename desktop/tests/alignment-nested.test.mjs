import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

// The candidate and the delivered test both use the nearest desktop package for unchanged helpers.
let desktop = dirname(fileURLToPath(import.meta.url));
for (;;) {
  try { if (JSON.parse(await readFile(join(desktop, 'package.json'), 'utf8')).name === 'suo-desktop') break; } catch {}
  const parent = dirname(desktop);
  if (parent === desktop) throw new Error('The desktop package could not be located.');
  desktop = parent;
}
const { nodeBoxes } = await import(pathToFileURL(join(desktop, 'src/geometry.ts')).href);
const { captureGroupResize } = await import(pathToFileURL(join(desktop, 'src/grouping.ts')).href);
const source = await readFile(process.env.SUO_ALIGNMENT_SOURCE ?? new URL('../src/actions.ts', import.meta.url), 'utf8');
const syntax = ts.createSourceFile('actions.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
const names = new Set(['alignSelected', 'record', 'travelHistory', 'update']);
const functions = syntax.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text));
assert.equal(functions.length, names.size, 'the actual alignment and history functions are extracted');
const code = ts.transpileModule(functions.map(node => node.getText(syntax)).join('\n'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const plain = value => JSON.parse(JSON.stringify(value));

function board(nodes) {
  let state = { historyVersion: 0, workspace: { id: 'fixture', nodes, edges: [{ id: 'edge', source: 'peer', target: 'child' }], messages: [], panels: {}, draftAttachments: [] } };
  const notices = [], history = { past: [], future: [] };
  const context = {
    exports: {}, nodeBoxes, captureGroupResize, structuredClone, history,
    bindings: { flow: null }, session: { dirty: false }, groupResizeGesture: null,
    scheduleSave: () => {}, notice: text => notices.push(text),
    app: { get: () => state, set: change => { state = { ...state, ...(typeof change === 'function' ? change(state) : change) }; } },
  };
  vm.runInNewContext(code, context);
  return { align: context.exports.alignSelected, undo: () => context.exports.travelHistory(false), redo: () => context.exports.travelHistory(true),
    get: () => state.workspace, history, notices };
}
const group = (id, x, y, parentId, selected = false) => ({ id, type: 'group', position: { x, y }, style: { width: 400, height: 300 }, ...(parentId ? { parentId } : {}), selected, data: { kind: 'group', title: id, content: '' } });
const card = (id, x, y, parentId, selected = true, width = 200) => ({ id, type: 'card', position: { x, y }, style: { width, height: 100 }, ...(parentId ? { parentId } : {}), selected, data: { kind: 'note', title: id, content: 'Keep this content.' } });
const nested = () => [group('outer', 500, 300, undefined, true), group('inner', 50, 70, 'outer'), card('child', 20, 30, 'inner'), card('peer', 0, 0)];

test('selected nested descendants move with their selected ancestor once for all six alignments', () => {
  for (const side of ['left', 'center', 'right', 'top', 'middle', 'bottom']) {
    const original = nested(), h = board(structuredClone(original));
    h.align(side);
    const next = h.get().nodes;
    for (const id of ['inner', 'child']) assert.deepEqual(plain(next.find(node => node.id === id)), original.find(node => node.id === id));
    const before = nodeBoxes(original), after = nodeBoxes(next), dx = after[0].x - before[0].x, dy = after[0].y - before[0].y;
    assert.deepEqual([after[2].x - before[2].x, after[2].y - before[2].y], [dx, dy]);
    assert.equal(h.history.past.length, 1);
    h.undo(); assert.deepEqual(plain(h.get().nodes), original);
    h.redo(); assert.deepEqual(plain(h.get().nodes), plain(next));
  }
});

test('selecting the intermediate group too does not align it or its child independently', () => {
  const original = nested(); original[1].selected = true;
  const h = board(structuredClone(original)); h.align('left');
  assert.equal(h.get().nodes[0].position.x, 0);
  assert.deepEqual(plain(h.get().nodes[1]), original[1]);
  assert.deepEqual(plain(h.get().nodes[2]), original[2]);
  assert.equal(h.history.past.length, 1);
});

test('a group and only its selected descendant are one alignment target and create no undo step', () => {
  const original = nested().filter(node => node.id !== 'peer');
  const h = board(structuredClone(original)); h.align('left');
  assert.deepEqual(plain(h.get().nodes), original);
  assert.equal(h.history.past.length, 0); assert.equal(h.notices.length, 1);
});

test('ordinary cards with an unselected shared parent still align and undo as one operation', () => {
  const original = [group('parent', 500, 100), card('a', 40, 20, 'parent'), card('b', 10, 180, 'parent', true, 100)];
  const h = board(structuredClone(original)); h.align('left');
  assert.deepEqual(plain(h.get().nodes[0]), original[0]);
  assert.deepEqual(h.get().nodes.slice(1).map(node => node.position.x), [10, 10]);
  const result = plain(h.get().nodes), edges = plain(h.get().edges);
  assert.equal(h.history.past.length, 1);
  h.undo(); assert.deepEqual(plain(h.get().nodes), original); assert.deepEqual(plain(h.get().edges), edges);
  assert.equal(h.history.past.length, 0); assert.equal(h.history.future.length, 1);
  h.redo(); assert.deepEqual(plain(h.get().nodes), result);
});

test('ordinary selected cards across unselected groups retain the existing absolute-selection alignment rule', () => {
  const original = [group('ga', 500, 0), card('a', 20, 10, 'ga'), group('gb', -100, 0), card('b', 50, 20, 'gb')];
  const h = board(structuredClone(original)); h.align('left');
  const next = h.get().nodes, boxes = nodeBoxes(next);
  assert.deepEqual(plain(next[0]), original[0]); assert.deepEqual(plain(next[2]), original[2]);
  assert.equal(boxes[1].x, -50); assert.equal(boxes[3].x, -50);
  assert.equal(next[1].parentId, 'ga'); assert.equal(next[3].parentId, 'gb');
  assert.equal(h.history.past.length, 1);
  h.undo(); assert.deepEqual(plain(h.get().nodes), original);
});
