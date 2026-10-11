import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { cleanNodes } from '../src/geometry.ts';
import { randomUUID } from 'node:crypto';

const source = await readFile(new URL('../src/actions.ts', import.meta.url), 'utf8');
const syntax = ts.createSourceFile('actions.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
const names = new Set(['hydrateDraftAttachments', 'serialize', 'scheduleSave', 'update', 'flush', 'switchSession', 'loadInitial']);
const functions = syntax.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text)).map(node => node.getText(syntax)).join('\n');
const code = ts.transpileModule(functions, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const clone = value => JSON.parse(JSON.stringify(value));
const tick = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function workspace(id) { return { id, title: id, version: 1, updatedAt: '2026-10-10T00:00:00Z', nodes: [], edges: [], messages: [], draft: '', panels: {} }; }

function harness() {
  const stored = new Map(['A', 'B', 'C'].map(id => [id, workspace(id)]));
  let state = { workspace: clone(stored.get('A')), busy: false, saveStatus: '已保存' };
  const loads = [], notices = [], saves = [];
  const session = { version: 1, dirty: false, saving: null, importing: false };
  const context = {
    exports: {}, crypto: { randomUUID }, structuredClone, session, workspaceLoads: { revision: 0 }, saveTimer: undefined, bindings: {}, history: { past: [], future: [] },
    clearTimeout() {}, setTimeout() { return 1; }, drainNodeChanges() {}, cleanNodes, withDrawingCard: value => value,
    notice: value => notices.push(value), stop: async () => {},
    app: { get: () => state, set: patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; } },
    request: async (method, payload = {}) => {
      if (method === 'workspace.list') return [...stored.values()].map(clone);
      if (method === 'workspace.load') {
        const pending = deferred(), snapshot = clone(stored.get(payload.id));
        loads.push({ id: payload.id, finish: () => pending.resolve(snapshot) });
        return pending.promise;
      }
      if (method === 'workspace.save') {
        const current = stored.get(payload.state.id);
        saves.push({ id: payload.state.id, expected: payload.expectedVersion, current: current.version });
        if (current.version !== payload.expectedVersion) throw new Error('会话已被另一个窗口更新。');
        const next = { ...clone(payload.state), version: current.version + 1 };
        stored.set(next.id, next); return clone(next);
      }
      throw new Error('unexpected request: ' + method);
    },
  };
  vm.runInNewContext(code, context);
  return { ...context.exports, get: () => state, session, stored, loads, notices, saves };
}

test('a late earlier session load cannot override the latest requested session', async () => {
  const h = harness();
  const first = h.switchSession('B'); await tick();
  const second = h.switchSession('C'); await tick();
  h.loads.find(load => load.id === 'C').finish(); await second;
  h.loads.find(load => load.id === 'B').finish(); await first;
  assert.equal(h.get().workspace.id, 'C');
});

test('overlapping loads cannot roll back this window\'s own saved version or edits', async () => {
  const h = harness();
  const first = h.switchSession('B'); await tick();
  const second = h.switchSession('B'); await tick();
  h.loads[1].finish(); await second;
  h.update(value => ({ ...value, draft: '自己的新内容' })); await h.flush();
  h.loads[0].finish(); await first;
  assert.equal(h.get().workspace.draft, '自己的新内容');
  assert.equal(h.session.version, 2);
  h.update(value => ({ ...value, draft: '继续修改' })); await h.flush();
  assert.equal(h.get().saveStatus, '已保存');
  assert.equal(h.notices.length, 0);
  assert.equal(h.stored.get('B').draft, '继续修改');
});

test('a late initial load cannot replace a session explicitly opened in the meantime', async () => {
  const h = harness();
  const initial = h.loadInitial(() => false); await tick();
  const switched = h.switchSession('B'); await tick();
  h.loads.find(load => load.id === 'B').finish(); await switched;
  h.loads.find(load => load.id === 'A').finish(); await initial;
  assert.equal(h.get().workspace.id, 'B');
});

test('a real external update still prevents overwriting newer saved data', async () => {
  const h = harness();
  h.stored.set('A', { ...h.stored.get('A'), version: 2, draft: '另一个窗口的数据' });
  h.update(value => ({ ...value, draft: '本窗口的数据' })); await h.flush();
  assert.equal(h.get().saveStatus, '保存失败');
  assert.equal(h.session.dirty, true);
  assert.equal(h.stored.get('A').draft, '另一个窗口的数据');
  assert.equal(h.notices.length, 1);
});

test('selecting the current session does not reload or replace local unsaved contents', async () => {
  const h = harness();
  h.update(value => ({ ...value, draft: '正在编辑的内容' }));
  await h.switchSession('A');
  assert.equal(h.loads.length, 0);
  assert.equal(h.get().workspace.draft, '正在编辑的内容');
  assert.equal(h.session.version, 2);
});


test('loading legacy geometry clears transient drag and resize flags before editing', async () => {
  const h = harness();
  h.stored.get('B').nodes = [{ id: 'legacy', position: { x: 1, y: 2 }, data: {}, dragging: true, resizing: true, selected: true, measured: { width: 300, height: 200 } }];
  const switched = h.switchSession('B'); await tick(); h.loads[0].finish(); await switched;
  const node = h.get().workspace.nodes[0];
  assert.equal(node.resizing, undefined); assert.equal(node.dragging, undefined); assert.equal(node.measured, undefined); assert.equal(node.selected, false);
  assert.equal(h.stored.get('B').nodes[0].resizing, true, 'loading does not mutate the saved record');
  h.update(value => ({ ...value, draft: '继续编辑' })); await h.flush();
  assert.equal(h.stored.get('B').nodes[0].resizing, undefined);
});
