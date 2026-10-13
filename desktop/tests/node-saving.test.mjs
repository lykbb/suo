import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import { applyNodeChanges } from '@xyflow/react';
import { cleanNodes } from '../src/geometry.ts';

const source = await readFile(new URL('../src/actions.ts', import.meta.url), 'utf8');
const syntax = ts.createSourceFile('actions.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
const names = new Set(['serialize', 'scheduleSave', 'update', 'flush', 'applyNodes', 'drainNodeChanges', 'onNodesChange']);
const functions = syntax.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text)).map(node => node.getText(syntax)).join('\n');
const code = ts.transpileModule(functions, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const clone = value => JSON.parse(JSON.stringify(value));
const tick = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };

function harness() {
  let workspace = { id: 'A', version: 1, nodes: [{ id: 'card', type: 'card', position: { x: 0, y: 0 }, width: 200, height: 130, data: { kind: 'note', title: '便签', content: '' } }], edges: [], messages: [], panels: {} };
  let state = { workspace, saveStatus: '已保存' }, stored = clone(workspace), serial = 0;
  const frames = new Map(), timers = new Map(), notices = [];
  const session = { dirty: false, version: 1, saving: null };
  const context = {
    exports: {}, session, saveTimer: undefined, nodeFrame: 0, queuedNodes: undefined, groupResizeGesture: undefined, bindings: {}, alignDrag: () => {},
    applyNodeChanges, cleanNodes, record() {}, notice: value => notices.push(value),
    // Each save carries a request id and a copy of the state, as in the browser.
    crypto: { randomUUID }, structuredClone,
    requestAnimationFrame: callback => { const id = ++serial; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: callback => { const id = ++serial; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
    app: { get: () => state, set: patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; } },
    request: async (method, payload) => {
      assert.equal(method, 'workspace.save');
      assert.equal(payload.expectedVersion, stored.version);
      stored = { ...clone(payload.state), version: stored.version + 1 };
      return clone(stored);
    },
  };
  vm.runInNewContext(code, context);
  return {
    ...context.exports, get: () => state, saved: () => stored, session, notices,
    paint: () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); },
    autosave: async () => { assert.equal(timers.size, 1, 'settled geometry must schedule one automatic save'); const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(callback => callback()); await tick(); },
    timerCount: () => timers.size,
  };
}

test('drag end merged with moving events in the same frame automatically saves the final position', async () => {
  const h = harness();
  h.onNodesChange([{ id: 'card', type: 'position', position: { x: 10, y: 15 }, dragging: true }]);
  h.onNodesChange([{ id: 'card', type: 'position', position: { x: 30, y: 45 }, dragging: false }]);
  h.paint(); await h.autosave();
  assert.deepEqual(h.saved().nodes[0].position, { x: 30, y: 45 });
  assert.equal(h.get().saveStatus, '已保存');
});

test('resize end without setAttributes resumes autosave after the moving frame', async () => {
  const h = harness();
  h.onNodesChange([{ id: 'card', type: 'dimensions', dimensions: { width: 280, height: 180 }, resizing: true, setAttributes: true }]);
  h.paint(); assert.equal(h.timerCount(), 0);
  h.onNodesChange([{ id: 'card', type: 'dimensions', dimensions: { width: 280, height: 180 }, resizing: false }]);
  h.paint(); await h.autosave();
  assert.equal(h.saved().nodes[0].width, 280);
  assert.equal(h.saved().nodes[0].height, 180);
  assert.equal(h.get().saveStatus, '已保存');
});

test('resize start and end merged in one frame save the final dimensions', async () => {
  const h = harness();
  h.onNodesChange([{ id: 'card', type: 'dimensions', dimensions: { width: 250, height: 160 }, resizing: true, setAttributes: true }]);
  h.onNodesChange([{ id: 'card', type: 'dimensions', dimensions: { width: 250, height: 160 }, resizing: false }]);
  h.paint(); await h.autosave();
  assert.equal(h.saved().nodes[0].width, 250);
  assert.equal(h.saved().nodes[0].height, 160);
});

test('ordinary measurement alone does not create a workspace save', () => {
  const h = harness();
  h.onNodesChange([{ id: 'card', type: 'dimensions', dimensions: { width: 200, height: 130 } }]);
  h.paint(); assert.equal(h.timerCount(), 0); assert.equal(h.session.dirty, false);
});
