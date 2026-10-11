import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { applyNodeChanges } from '@xyflow/react';
import * as grouping from '../src/grouping.ts';
import { cleanNodes, groupCards, ungroupCards } from '../src/geometry.ts';

const clone = value => JSON.parse(JSON.stringify(value));
const card = (id, x, y, width = 300, height = 200, extra = {}) => ({ id, type: 'card', position: { x, y }, style: { width, height }, data: { kind: 'note', title: id, content: '内容' }, ...extra });
const group = (id = 'g', x = 100, y = 80, width = 800, height = 600, extra = {}) => ({ ...card(id, x, y, width, height), type: 'group', data: { kind: 'group', title: '分组', content: '' }, ...extra });
const fixture = () => [group(), card('a', 40, 60, 300, 200, { parentId: 'g' }), card('b', 430, 330, 300, 200, { parentId: 'g' }), card('outside', 1100, 200)];
const at = (nodes, id) => grouping.absoluteCardPosition(nodes, nodes.find(node => node.id === id));
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

for (const edge of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']) test(`group resize from ${edge} scales member positions and sizes from one baseline`, () => {
  const nodes = fixture(), snapshot = grouping.captureGroupResize(nodes, 'g');
  const width = edge.includes('e') || edge.includes('w') ? 1000 : 800;
  const height = edge.includes('n') || edge.includes('s') ? 750 : 600;
  const desired = { x: edge.includes('w') ? -100 : 100, y: edge.includes('n') ? -70 : 80, width, height };
  const resized = grouping.resizeGroupCards(nodes, snapshot, desired);
  for (const id of ['a', 'b']) {
    const source = nodes.find(node => node.id === id), next = resized.find(node => node.id === id);
    near(next.position.x, source.position.x * width / 800); near(next.position.y, source.position.y * height / 600);
    near(next.width, 300 * width / 800); near(next.height, 200 * height / 600);
    assert.equal(next.measured.width, next.width); assert.equal(next.style.width, next.width);
    near(at(resized, id).x, desired.x + next.position.x); near(at(resized, id).y, desired.y + next.position.y);
  }
  assert.equal(resized.at(-1), nodes.at(-1));
});

test('minimum bounds protect all cards and keep the opposite corner fixed', () => {
  const nodes = fixture(), snapshot = grouping.captureGroupResize(nodes, 'g');
  const next = grouping.resizeGroupCards(nodes, snapshot, { x: 700, y: 630, width: 200, height: 50 });
  const container = next[0];
  near(container.position.x + container.width, 900); near(container.position.y + container.height, 680);
  for (const member of next.filter(node => node.parentId === 'g')) { assert.ok(member.width >= 200 - 1e-8); assert.ok(member.height >= 130 - 1e-8); }
});

test('resize overwrites stale measurement and does not accumulate error across frames or repeated gestures', () => {
  const nodes = fixture(), snapshot = grouping.captureGroupResize(nodes, 'g');
  const desired = { x: -7, y: -13, width: 907, height: 693 };
  let frames = nodes;
  for (let i = 0; i < 30; i++) frames = grouping.resizeGroupCards(frames, snapshot, desired);
  assert.deepEqual(frames, grouping.resizeGroupCards(nodes, snapshot, desired));
  for (const member of frames.filter(node => node.parentId)) assert.deepEqual(member.measured, { width: member.width, height: member.height });
  const second = grouping.captureGroupResize(frames, 'g');
  const restoredSize = grouping.resizeGroupCards(frames, second, snapshot.rect, false);
  for (const id of ['a', 'b']) { near(restoredSize.find(node => node.id === id).position.x, nodes.find(node => node.id === id).position.x); near(restoredSize.find(node => node.id === id).width, 300); }
});

test('nested children remain relative and cancellation restores geometry while preserving edited content', () => {
  const nodes = [group(), group('nested', 30, 50, 450, 330, { parentId: 'g' }), card('a', 40, 50, 250, 180, { parentId: 'nested' })];
  const snapshot = grouping.captureGroupResize(nodes, 'g');
  let next = grouping.resizeGroupCards(nodes, snapshot, { x: -100, y: -70, width: 1000, height: 750 });
  assert.deepEqual(next[2].position, { x: 50, y: 62.5 }); assert.deepEqual(at(next, 'a'), { x: -12.5, y: 55 });
  next = next.map(node => node.id === 'a' ? { ...node, data: { ...node.data, content: '继续编辑的内容' } } : node);
  const restored = grouping.restoreGroupResize(next, snapshot);
  assert.deepEqual(restored.map(node => node.position), nodes.map(node => node.position));
  assert.equal(restored[2].data.content, '继续编辑的内容'); assert.equal(restored[0].resizing, false);
});

test('center entry joins a group and expands its bounds without moving existing or incoming cards', () => {
  const nodes = [card('incoming', -20, 150), group('g', 100, 80, 400, 350), card('a', 40, 60, 250, 160, { parentId: 'g' })];
  const before = Object.fromEntries(nodes.map(node => [node.id, at(nodes, node.id)]));
  const next = grouping.reparentDraggedCards(nodes, ['incoming']);
  assert.equal(next.find(node => node.id === 'incoming').parentId, 'g');
  assert.ok(next.findIndex(node => node.id === 'g') < next.findIndex(node => node.id === 'incoming'));
  assert.deepEqual(at(next, 'incoming'), before.incoming); assert.deepEqual(at(next, 'a'), before.a);
  assert.equal(next.find(node => node.id === 'g').position.x, -44);
  assert.deepEqual(next.find(node => node.id === 'incoming').data, nodes[0].data);
});

test('dragging a member out detaches it at the same absolute position, and dragging a whole group preserves membership', () => {
  const nodes = fixture().map(node => node.id === 'a' ? { ...node, position: { x: 900, y: 600 }, extent: 'parent', expandParent: true, selected: true } : node);
  const next = grouping.reparentDraggedCards(nodes, ['a']);
  assert.equal(next[1].parentId, undefined); assert.equal(next[1].extent, undefined); assert.equal(next[1].expandParent, false);
  assert.deepEqual(next[1].position, { x: 1000, y: 680 }); assert.equal(next[1].selected, true);
  assert.equal(grouping.reparentDraggedCards(nodes, ['g', 'a', 'b']), nodes);
});

test('an overlapping current group wins, while the header alone is not a drop target', () => {
  const nodes = [group('g', 0, 0, 500, 500), group('other', 0, 0, 400, 400), card('a', 40, 70, 200, 130, { parentId: 'g' })];
  assert.equal(grouping.reparentDraggedCards(nodes, ['a']).find(node => node.id === 'a').parentId, 'g');
  const header = [group('g', 0, 0, 500, 500), card('a', 50, -60, 200, 130)];
  assert.equal(grouping.reparentDraggedCards(header, ['a']), header);
});

test('group selection plans distinguish creation, toggling, joining, and multiple group boundaries', () => {
  const plain = [card('a', 0, 0, 300, 200, { selected: true }), card('b', 400, 0, 300, 200, { selected: true })];
  assert.deepEqual(grouping.groupSelectionPlan(plain), { kind: 'create', cardIds: ['a', 'b'] });
  const grouped = groupCards(plain, 'g');
  assert.equal(grouped[0].selected, true); assert.deepEqual(grouping.groupSelectionPlan(grouped), { kind: 'ungroup', groupId: 'g' });
  const members = grouped.map(node => ({ ...node, selected: node.id !== 'g' }));
  assert.deepEqual(grouping.groupSelectionPlan(members), { kind: 'ungroup', groupId: 'g' });
  assert.deepEqual(grouping.groupSelectionPlan([...members, card('new', 900, 100, 300, 200, { selected: true })]), { kind: 'join', groupId: 'g', cardIds: ['new'] });
  assert.deepEqual(grouping.groupSelectionPlan([...members, group('other', 1000, 100, 400, 400, { selected: true })]), { kind: 'none', reason: 'multiple-groups' });
});

const source = await readFile(new URL('../src/actions.ts', import.meta.url), 'utf8');
const syntax = ts.createSourceFile('actions.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
const names = new Set(['serialize', 'scheduleSave', 'update', 'flush', 'record', 'travelHistory', 'applyNodes', 'drainNodeChanges', 'onNodesChange', 'beginGroupResize', 'previewGroupResize', 'endGroupResize', 'cancelGroupResize', 'groupSelected', 'toggleGroupSelected', 'ungroup', 'ungroupSelected', 'finishNodeDrag']);
const functions = syntax.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text)).map(node => node.getText(syntax)).join('\n');
const code = ts.transpileModule(functions, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function harness(initial = fixture()) {
  let state = { workspace: { id: 'fixture', nodes: initial, edges: [], messages: [], panels: {}, version: 1 }, historyVersion: 0, editor: { id: 'a', title: 'a', content: '编辑中' }, sessionManaging: false };
  let stored, serial = 0;
  const frames = new Map(), timers = new Map(), notices = [];
  const history = { past: [], future: [] }, session = { dirty: false, version: 1, saving: null };
  const context = {
    exports: {}, history, session, saveTimer: undefined, nodeFrame: 0, queuedNodes: undefined, groupResizeGesture: undefined, bindings: {}, ...grouping,
    applyNodeChanges, cleanNodes, groupCards, ungroupCards, structuredClone, crypto: { randomUUID: () => 'created' }, notice: value => notices.push(value),
    requestAnimationFrame: callback => { const id = ++serial; frames.set(id, callback); return id; }, cancelAnimationFrame: id => frames.delete(id),
    setTimeout: callback => { const id = ++serial; timers.set(id, callback); return id; }, clearTimeout: id => timers.delete(id),
    app: { get: () => state, set: patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; } },
    request: async (method, payload) => { assert.equal(method, 'workspace.save'); stored = clone(payload.state); return { ...stored, version: 2 }; },
  };
  vm.runInNewContext(code, context);
  return { ...context.exports, history, session, context, get: () => state, saved: () => stored, notices,
    set: patch => context.app.set(patch), paint: () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); }, timerCount: () => timers.size };
}

test('one group resize gesture saves every member, then one undo restores the whole group and redo reapplies it', async () => {
  const h = harness(), before = clone(h.get().workspace.nodes);
  h.beginGroupResize('g');
  for (const rect of [{ x: 60, y: 50, width: 840, height: 630 }, { x: -100, y: -70, width: 1000, height: 750 }]) {
    h.previewGroupResize('g', rect);
    h.onNodesChange([{ id: 'g', type: 'position', position: { x: rect.x, y: rect.y } }, { id: 'g', type: 'dimensions', dimensions: { width: rect.width, height: rect.height }, resizing: true, setAttributes: true }, { id: 'a', type: 'position', position: { x: 999, y: 999 } }]);
    h.paint(); assert.equal(h.timerCount(), 0);
  }
  assert.equal(h.history.past.length, 1);
  h.endGroupResize('g'); h.onNodesChange([{ id: 'g', type: 'dimensions', dimensions: { width: 1000, height: 750 }, resizing: false }]); h.paint();
  assert.equal(h.timerCount(), 1); assert.equal(h.get().workspace.nodes[0].resizing, false);
  const after = clone(h.get().workspace.nodes);
  assert.deepEqual(after[1].position, { x: 50, y: 75 }); assert.equal(after[1].width, 375);
  await h.flush(); assert.equal(h.saved().nodes[1].style.width, 375); assert.equal(h.saved().nodes[1].width, 375); assert.equal(h.saved().nodes[1].measured, undefined);
  h.travelHistory(false); assert.deepEqual(clone(h.get().workspace.nodes), before);
  h.travelHistory(true); assert.deepEqual(clone(h.get().workspace.nodes), after);
});

test('Escape cancellation restores all geometry, keeps the editor, discards only the gesture history, and ignores stale library events', () => {
  const h = harness(), before = clone(h.get().workspace.nodes), editor = h.get().editor;
  h.beginGroupResize('g'); h.previewGroupResize('g', { x: 0, y: 0, width: 900, height: 680 });
  h.onNodesChange([{ id: 'g', type: 'dimensions', dimensions: { width: 900, height: 680 }, resizing: true, setAttributes: true }]); h.paint();
  assert.equal(h.cancelGroupResize('g'), true); assert.equal(h.history.past.length, 0); assert.equal(h.get().editor, editor);
  h.onNodesChange([{ id: 'g', type: 'dimensions', dimensions: { width: 900, height: 680 }, resizing: true, setAttributes: true }, { id: 'a', type: 'position', position: { x: 999, y: 999 } }]); h.paint();
  h.endGroupResize('g'); h.onNodesChange([{ id: 'g', type: 'dimensions', dimensions: { width: 900, height: 680 }, resizing: false }]); h.paint();
  for (const node of h.get().workspace.nodes) { const original = before.find(item => item.id === node.id); assert.deepEqual(clone(node.position), original.position); assert.deepEqual(clone(node.style), original.style); assert.equal(node.width, original.width); }
  assert.equal(h.context.groupResizeGesture, undefined);
});

test('Cmd+G immediately toggles a new group, Cmd+G joins a scatter card, and Shift+Cmd+G recognizes its member', () => {
  const initial = [card('a', 0, 0, 300, 200, { selected: true }), card('b', 400, 0, 300, 200, { selected: true })];
  const h = harness(initial), editor = h.get().editor;
  h.toggleGroupSelected(); assert.equal(h.get().workspace.nodes[0].selected, true); assert.equal(h.get().editor, editor); assert.equal(h.get().workspace.nodes.find(node => node.id === 'a').selected, true);
  h.toggleGroupSelected(); assert.equal(h.get().workspace.nodes.some(node => node.data.kind === 'group'), false); assert.deepEqual(h.get().workspace.nodes.map(node => clone(node.position)), initial.map(node => node.position));
  h.toggleGroupSelected();
  h.set({ workspace: { ...h.get().workspace, nodes: [...h.get().workspace.nodes, card('new', 1000, 100, 300, 200, { selected: true })] } });
  h.toggleGroupSelected(); assert.equal(h.get().workspace.nodes.find(node => node.id === 'new').parentId, 'created'); assert.deepEqual(at(h.get().workspace.nodes, 'new'), { x: 1000, y: 100 });
  h.set({ workspace: { ...h.get().workspace, nodes: h.get().workspace.nodes.map(node => ({ ...node, selected: node.id === 'new' })) } });
  h.ungroupSelected(); assert.equal(h.get().workspace.nodes.some(node => node.data.kind === 'group'), false); assert.equal(h.get().editor, editor);
});

test('drop drains the final queued position, shares the existing drag undo step, and preserves the active editor', () => {
  const nodes = [group('g', 100, 80, 500, 400), card('a', 900, 200, 250, 160, { selected: true })], h = harness(nodes), editor = h.get().editor;
  h.record(); h.onNodesChange([{ id: 'a', type: 'position', position: { x: 50, y: 150 }, dragging: false }]);
  h.finishNodeDrag(null, nodes[1], [nodes[1]]);
  assert.equal(h.get().workspace.nodes[1].parentId, 'g'); assert.deepEqual(at(h.get().workspace.nodes, 'a'), { x: 50, y: 150 }); assert.equal(h.get().editor, editor); assert.equal(h.history.past.length, 1);
  h.travelHistory(false); assert.deepEqual(clone(h.get().workspace.nodes), clone(nodes));
});

test('ending an unchanged resize records no history and does not autosave geometry', () => {
  const h = harness(), before = clone(h.get().workspace.nodes);
  h.beginGroupResize('g'); h.endGroupResize('g');
  h.onNodesChange([{ id: 'g', type: 'dimensions', dimensions: { width: 800, height: 600 }, resizing: false }]); h.paint();
  assert.equal(h.history.past.length, 0); assert.equal(h.timerCount(), 0); assert.equal(h.session.dirty, false);
  for (const node of h.get().workspace.nodes) assert.deepEqual(clone(node.position), before.find(item => item.id === node.id).position);
  assert.equal(h.context.groupResizeGesture, undefined);
});

test('a cancelled gesture can resize again with a fresh baseline and one undo step', () => {
  const h = harness();
  h.beginGroupResize('g'); h.previewGroupResize('g', { x: 100, y: 80, width: 1000, height: 750 });
  h.onNodesChange([{ id: 'g', type: 'dimensions', dimensions: { width: 1000, height: 750 }, resizing: true, setAttributes: true }]); h.paint();
  h.cancelGroupResize('g'); h.endGroupResize('g'); h.onNodesChange([{ id: 'g', type: 'dimensions', dimensions: { width: 1000, height: 750 }, resizing: false }]); h.paint();
  h.beginGroupResize('g'); h.previewGroupResize('g', { x: 100, y: 80, width: 1200, height: 900 });
  h.onNodesChange([{ id: 'g', type: 'dimensions', dimensions: { width: 1200, height: 900 }, resizing: true, setAttributes: true }]);
  h.endGroupResize('g'); h.onNodesChange([{ id: 'g', type: 'dimensions', dimensions: { width: 1200, height: 900 }, resizing: false }]); h.paint();
  assert.equal(h.get().workspace.nodes[1].width, 450); assert.deepEqual(clone(h.get().workspace.nodes[1].position), { x: 60, y: 90 }); assert.equal(h.history.past.length, 1);
  h.travelHistory(false); assert.equal(h.get().workspace.nodes[0].style.width, 800); assert.deepEqual(clone(h.get().workspace.nodes[1].position), { x: 40, y: 60 });
});

test('the group button creates or joins but does not dismantle a current group', () => {
  const h = harness(fixture().map(node => ({ ...node, selected: node.id === 'a' || node.id === 'b' })));
  h.groupSelected(); assert.equal(h.get().workspace.nodes[0].data.kind, 'group'); assert.equal(h.history.past.length, 0);
  h.set({ workspace: { ...h.get().workspace, nodes: h.get().workspace.nodes.map(node => ({ ...node, selected: node.id === 'g' || node.id === 'outside' })) } });
  h.groupSelected(); assert.equal(h.get().workspace.nodes.find(node => node.id === 'outside').parentId, 'g'); assert.equal(h.history.past.length, 1);
});
