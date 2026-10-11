import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { arrangeBoardNodes, classifyBoardNodes } from '../src/boardLayout.ts';
import { absoluteCardPosition, cardSize } from '../src/grouping.ts';

const clone = value => JSON.parse(JSON.stringify(value));
const card = (id, width = 258, height = 174, extra = {}) => ({ id, type: 'card', position: { x: id.length * 900, y: id.length * 700 }, style: { width, height }, data: { kind: 'note', title: id, content: '原内容' }, ...extra });
const group = (id, extra = {}) => ({ ...card(id, 3000, 3000, extra), type: 'group', data: { kind: 'group', title: id, content: '' } });
function noOverlap(nodes) {
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j];
    if (a.parentId !== b.parentId) continue;
    const x = cardSize(a), y = cardSize(b);
    assert.ok(a.position.x + x.width <= b.position.x || b.position.x + y.width <= a.position.x || a.position.y + x.height <= b.position.y || b.position.y + y.height <= a.position.y, `${a.id} overlaps ${b.id}`);
  }
  for (const node of nodes.filter(node => node.parentId)) {
    const parent = nodes.find(value => value.id === node.parentId), box = cardSize(node), container = cardSize(parent);
    assert.ok(node.position.x >= 24 && node.position.y >= 44);
    assert.ok(node.position.x + box.width + 24 <= container.width + .001 && node.position.y + box.height + 24 <= container.height + .001);
  }
}

test('repeat arrangement is deterministic and keeps IDs, content and different card/file sizes', () => {
  const nodes = [card('note', 210, 131), card('document', 430, 520), card('file', 380, 280, { data: { kind: 'file', title: 'Excel', content: '', asset: { id: 'asset-1', kind: 'spreadsheet', name: '数据.xlsx' } } }), card('image', 620, 180)];
  const before = clone(nodes), once = arrangeBoardNodes(nodes), twice = arrangeBoardNodes(once);
  assert.equal(twice, once); assert.deepEqual(nodes, before); noOverlap(once);
  for (const node of once) { const old = nodes.find(value => value.id === node.id); assert.deepEqual(node.data, old.data); assert.deepEqual(cardSize(node), cardSize(old)); }
});

test('nested groups keep their relationships and shrink around descendants without blank regions', () => {
  const nodes = [group('outer'), group('inner', { parentId: 'outer' }), card('a', 220, 140, { parentId: 'inner' }), card('b', 300, 220, { parentId: 'inner' }), card('c', 380, 280, { parentId: 'outer' }), card('outside')];
  const next = arrangeBoardNodes(nodes); noOverlap(next);
  assert.deepEqual(next.map(node => [node.id, node.parentId]), nodes.map(node => [node.id, node.parentId]));
  assert.ok(cardSize(next[0]).width < 1500 && cardSize(next[0]).height < 1000);
  assert.equal(arrangeBoardNodes(next), next);
});

test('explicit columns means exactly that number per row even with highly uneven widths', () => {
  const nodes = [card('wide', 1000, 174), ...Array.from({ length: 8 }, (_, index) => card(`small-${index}`, 100, 174))];
  const next = arrangeBoardNodes(nodes, { columns: 2 });
  const rows = new Map();
  for (const node of next) rows.set(node.position.y, (rows.get(node.position.y) ?? 0) + 1);
  assert.equal(rows.size, 5); assert.ok([...rows.values()].every(count => count <= 2)); noOverlap(next);
});

test('a selected subtree avoids stationary root siblings and preserves original groups', () => {
  const nodes = [group('g'), card('inside', 300, 160, { parentId: 'g' }), card('blocker', 430, 600, { position: { x: 800, y: 680 } })];
  const next = arrangeBoardNodes(nodes, { ids: ['inside'] });
  assert.equal(next.at(-1), nodes.at(-1)); noOverlap(next); assert.equal(next[1].parentId, 'g');
});

test('a selected subtree resizes stale sibling groups around descendants before avoiding stationary roots', () => {
  const nodes = [
    group('outer', { position: { x: 0, y: 0 }, style: { width: 1000, height: 600 } }),
    group('left', { parentId: 'outer', position: { x: 24, y: 44 }, style: { width: 320, height: 220 } }),
    card('a', 258, 174, { parentId: 'left', position: { x: 24, y: 44 } }),
    group('right', { parentId: 'outer', position: { x: 600, y: 44 }, style: { width: 320, height: 220 } }),
    card('b', 1200, 700, { parentId: 'right', position: { x: 24, y: 44 } }),
    card('outside', 300, 500, { position: { x: 0, y: 700 } }),
  ];
  const before = clone(nodes), outside = nodes.at(-1);
  const bounds = (items, id) => { const node = items.find(node => node.id === id); return { ...absoluteCardPosition(items, node), ...cardSize(node) }; };
  const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  assert.equal(intersects(bounds(nodes, 'b'), bounds(nodes, 'outside')), false);
  const next = arrangeBoardNodes(nodes, { ids: ['a'] });
  noOverlap(next);
  assert.equal(next.at(-1), outside, 'the stationary root keeps its position and dimensions');
  assert.equal(intersects(bounds(next, 'b'), bounds(next, 'outside')), false);
  assert.deepEqual(next.map(node => [node.id, node.parentId]), nodes.map(node => [node.id, node.parentId]));
  assert.deepEqual(nodes, before, 'planning does not mutate the original board');
});

test('smart classification reuses stable group IDs and never duplicates or removes cards', () => {
  const nodes = [card('a'), card('b'), card('untouched')], plan = { groups: [{ id: 'new:requirements', title: '需求', memberIds: ['a', 'b'] }] };
  const once = classifyBoardNodes(nodes, plan), twice = classifyBoardNodes(once, plan);
  assert.equal(once.length, 4); assert.equal(twice.length, 4); assert.deepEqual(twice, once); noOverlap(once);
  for (const node of nodes) assert.deepEqual(once.find(value => value.id === node.id).data, node.data);
  assert.equal(once.find(node => node.id === 'untouched').parentId, undefined);
});

test('new category keys reuse the same member containers, including nested aliases and deliberate renames', () => {
  const nodes = [card('a'), card('b')];
  const plan = suffix => ({ groups: [{ id: `new:outer-${suffix}`, title: `上级${suffix}`, memberIds: [`new:inner-${suffix}`] }, { id: `new:inner-${suffix}`, title: `内容${suffix}`, memberIds: ['a', 'b'] }] });
  const once = classifyBoardNodes(nodes, plan('one'), { allowRegroup: true });
  let result = once;
  for (const suffix of ['two', 'three', 'four']) result = classifyBoardNodes(result, plan(suffix), { allowRegroup: true });
  assert.equal(result.length, 4); assert.deepEqual(result.map(node => node.id), once.map(node => node.id));
  assert.equal(result.filter(node => node.data.kind === 'group').length, 2);
  assert.ok(result.some(node => node.data.title === '内容four')); noOverlap(result);
  const preserved = classifyBoardNodes(once, plan('other'));
  assert.deepEqual(preserved.map(node => node.data.title), once.map(node => node.data.title));
});

test('moving members out preserves the old group but collapses its unused dimensions', () => {
  const nodes = [group('old'), card('a', 258, 174, { parentId: 'old' }), card('b')];
  const next = classifyBoardNodes(nodes, { groups: [{ id: 'new:merged', title: '合并', memberIds: ['a', 'b'] }] }, { allowRegroup: true });
  assert.deepEqual(cardSize(next.find(node => node.id === 'old')), { width: 320, height: 220 }); noOverlap(next);
});

test('default classification can add scatter cards to an existing group but cannot change old nesting', () => {
  const nodes = [group('outer'), group('inner', { parentId: 'outer' }), card('a', 258, 174, { parentId: 'inner' }), card('free')];
  const next = classifyBoardNodes(nodes, { groups: [{ id: 'inner', memberIds: ['free', 'a'] }] });
  assert.equal(next.find(node => node.id === 'free').parentId, 'inner'); assert.equal(next.find(node => node.id === 'inner').parentId, 'outer'); noOverlap(next);
  assert.throws(() => classifyBoardNodes(nodes, { groups: [{ id: 'outer', memberIds: ['a'] }] }), /明确要求重新归类/);
  const reused = classifyBoardNodes(nodes, { groups: [{ id: 'new:new-parent', title: '新上级', memberIds: ['inner'] }] });
  assert.deepEqual(reused.map(node => node.id), nodes.map(node => node.id));
  assert.equal(reused.find(node => node.id === 'inner').parentId, 'outer');
  assert.equal(reused.find(node => node.id === 'outer').data.title, nodes[0].data.title);
  assert.throws(() => classifyBoardNodes(nodes, { groups: [{ id: 'new:changed-parent', title: '新上级', memberIds: ['inner', 'free'] }] }), /明确要求重新归类/);
});

test('explicit regroup changes relations while retaining all old groups and nested content', () => {
  const nodes = [group('old'), group('nested', { parentId: 'old' }), card('a', 258, 174, { parentId: 'nested' }), card('b')];
  const next = classifyBoardNodes(nodes, { groups: [{ id: 'new:research', title: '调研', memberIds: ['nested', 'b'] }] }, { allowRegroup: true });
  assert.ok(next.some(node => node.id === 'old')); assert.equal(next.find(node => node.id === 'a').parentId, 'nested'); noOverlap(next);
  assert.equal(classifyBoardNodes(next, { groups: [{ id: 'new:research', title: '调研', memberIds: ['nested', 'b'] }] }, { allowRegroup: true }).length, next.length);
});

test('late invalid member, duplicate assignment, cycle and missing parents fail with no partial changes', () => {
  const nodes = [group('old'), card('a', 258, 174, { parentId: 'old' }), card('b')], before = clone(nodes);
  for (const plan of [
    { groups: [{ id: 'new:first', title: '第一组', memberIds: ['b'] }, { id: 'new:last', title: '失败组', memberIds: ['missing'] }] },
    { groups: [{ id: 'new:first', title: '第一组', memberIds: ['b'] }, { id: 'old', memberIds: ['b'] }] },
    { groups: [{ id: 'new:first', title: '第一组', memberIds: ['new:second'] }, { id: 'new:second', title: '第二组', memberIds: ['new:first'] }] },
  ]) { assert.throws(() => classifyBoardNodes(nodes, plan, { allowRegroup: true })); assert.deepEqual(nodes, before); }
  assert.throws(() => arrangeBoardNodes([card('bad', 258, 174, { parentId: 'missing' })]));
});

test('one local arrangement uses existing history for whole undo/redo and never calls a model', async () => {
  const source = await readFile(new URL('../src/boardOrganize.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source.replace(/^import .*;$/gmu, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const actions = await readFile(new URL('../src/actions.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('actions.ts', actions, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && ['update', 'record', 'travelHistory'].includes(node.name?.text)).map(node => node.getText(ast)).join('\n');
  const actionsCode = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const before = [card('a'), card('b', 400, 200)], notices = [], history = { past: [], future: [] };
  const originalView = { x: -10000, y: -10000, zoom: 1 }, arrangedView = { x: 100, y: 200, zoom: .7 };
  let view = originalView, frames = 0;
  let state = { workspace: { id: 'test', nodes: before, edges: [{ id: 'edge', source: 'a', target: 'b' }], messages: [], panels: {}, viewport: originalView }, busy: false, sessionManaging: false, historyVersion: 0 };
  const context = { exports: {}, arrangeBoardNodes, history, session: { dirty: false }, structuredClone, groupResizeGesture: undefined, scheduleSave() {}, reducedMotion: () => true,
    bindings: { flow: { getViewport: () => view, setViewport(next) { view = next; } } },
    frameBoard() { frames++; view = arrangedView; state.workspace = { ...state.workspace, viewport: arrangedView }; },
    notice: value => notices.push(value), drainNodeChanges() {}, app: { get: () => state, set: patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; } } };
  vm.runInNewContext(actionsCode, context);
  const travel = context.exports.travelHistory;
  Object.assign(context, { record: context.exports.record, update: context.exports.update });
  vm.runInNewContext(code, context);
  assert.equal(context.exports.arrangeCurrentBoard(), true); const after = clone(state.workspace);
  assert.equal(history.past.length, 1); assert.deepEqual(after.edges, state.workspace.edges);
  context.exports.arrangeCurrentBoard(); assert.equal(history.past.length, 1); assert.equal(frames, 1);
  travel(false); assert.deepEqual(state.workspace.nodes, before); assert.deepEqual(view, originalView);
  travel(true); assert.deepEqual(clone(state.workspace), after); assert.deepEqual(view, arrangedView);
  state.workspace.nodes = [...before, card('duplicate', 258, 174, { id: 'a' })];
  const invalid = clone(state.workspace), count = history.past.length;
  assert.equal(context.exports.arrangeCurrentBoard(), false); assert.deepEqual(clone(state.workspace), invalid); assert.equal(history.past.length, count);
});

test('a large mixed board stays compact and finite without changing file references', () => {
  const nodes = Array.from({ length: 400 }, (_, index) => card(`node-${index}`, 200 + index % 5 * 31, 130 + index % 9 * 29, index % 8 ? {} : { data: { kind: 'file', title: '资料', content: '', asset: { id: `asset-${index}`, name: '资料.pdf', kind: 'pdf' } } }));
  const next = arrangeBoardNodes(nodes); noOverlap(next);
  assert.ok(next.every(node => Number.isFinite(node.position.x) && Number.isFinite(node.position.y)));
  const total = nodes.reduce((sum, node) => sum + cardSize(node).width * cardSize(node).height, 0);
  const origin = { x: Math.min(...next.map(node => node.position.x)), y: Math.min(...next.map(node => node.position.y)) };
  const width = Math.max(...next.map(node => node.position.x + cardSize(node).width)) - origin.x, height = Math.max(...next.map(node => node.position.y + cardSize(node).height)) - origin.y;
  assert.ok(width * height < total * 1.6); assert.equal(arrangeBoardNodes(next), next);
});
