import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { addEdge, ConnectionMode, getEdgePosition, Position, XYHandle } from '@xyflow/system';
import { connectionSides, disconnectEdges, facingSides, lowerLabelEdges } from '../src/cardLinks.ts';

const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left];
const plain = value => JSON.parse(JSON.stringify(value));
const box = (x = 0, y = 0, width = 200, height = 100) => ({ x, y, width, height });
const anchor = (rect, side) => ({
  top: { x: rect.x + rect.width / 2, y: rect.y },
  right: { x: rect.x + rect.width, y: rect.y + rect.height / 2 },
  bottom: { x: rect.x + rect.width / 2, y: rect.y + rect.height },
  left: { x: rect.x, y: rect.y + rect.height / 2 },
})[side];

function internalNode(id, rect) {
  return { id, measured: { width: rect.width, height: rect.height }, internals: {
    positionAbsolute: { x: rect.x, y: rect.y },
    handleBounds: { source: SIDES.map(side => {
      const point = anchor(box(0, 0, rect.width, rect.height), side);
      return { id: side, nodeId: id, type: 'source', position: side, x: point.x, y: point.y, width: 0, height: 0 };
    }), target: [] },
  } };
}

function handleElement(nodeId, handleId) {
  const attributes = { 'data-nodeid': nodeId, 'data-handleid': handleId };
  const classes = new Set(['react-flow__handle', 'source', 'connectable', 'connectableend']);
  return { getAttribute: name => attributes[name] ?? null, classList: { contains: name => classes.has(name) } };
}

test('the installed Loose connection validator and edge resolver accept all 16 source port combinations', () => {
  const sourceRect = box(15, 30, 250, 120), targetRect = box(470, 350, 380, 260);
  const sourceNode = internalNode('a', sourceRect), targetNode = internalNode('b', targetRect);
  const nodeLookup = new Map([['a', sourceNode], ['b', targetNode]]);
  for (const sourceHandle of SIDES) for (const targetHandle of SIDES) {
    const element = handleElement('b', targetHandle);
    const result = XYHandle.isValid({ clientX: 500, clientY: 400 }, {
      handle: { nodeId: 'b', id: targetHandle, type: 'source' },
      connectionMode: ConnectionMode.Loose, fromNodeId: 'a', fromHandleId: sourceHandle, fromType: 'source',
      doc: { querySelector: () => element, elementFromPoint: () => element }, lib: 'react', flowId: 'fixture',
      isValidConnection: connection => connection.source !== connection.target, nodeLookup,
    });
    assert.equal(result.isValid, true, `${sourceHandle} -> ${targetHandle}`);
    assert.deepEqual(result.connection, { source: 'a', sourceHandle, target: 'b', targetHandle });
    assert.equal(result.toHandle.id, targetHandle);
    const errors = [];
    const position = getEdgePosition({ id: 'fixture', sourceNode, targetNode, sourceHandle, targetHandle,
      connectionMode: ConnectionMode.Loose, onError: (...args) => errors.push(args) });
    assert.deepEqual(errors, []);
    assert.equal(position.sourcePosition, sourceHandle);
    assert.equal(position.targetPosition, targetHandle);
    assert.deepEqual({ x: position.sourceX, y: position.sourceY }, anchor(sourceRect, sourceHandle));
    assert.deepEqual({ x: position.targetX, y: position.targetY }, anchor(targetRect, targetHandle));
  }
});

test('the actual validator still rejects a self connection with the canvas rule', () => {
  const node = internalNode('a', box()), element = handleElement('a', 'right');
  const result = XYHandle.isValid({ clientX: 200, clientY: 50 }, {
    handle: { nodeId: 'a', id: 'right', type: 'source' }, connectionMode: ConnectionMode.Loose,
    fromNodeId: 'a', fromHandleId: 'left', fromType: 'source', nodeLookup: new Map([['a', node]]),
    doc: { querySelector: () => element, elementFromPoint: () => element }, lib: 'react', flowId: 'fixture',
    isValidConnection: connection => connection.source !== connection.target,
  });
  assert.equal(result.isValid, false);
});

test('same-side routes preserve all four selected sides even where automatic routing would differ', () => {
  const source = box(40, 80, 258, 170), target = box(450, 470, 380, 280);
  for (const side of SIDES) {
    const route = connectionSides(source, target, side, side);
    assert.equal(route.from, side); assert.equal(route.to, side);
    assert.deepEqual(route.start, anchor(source, side)); assert.deepEqual(route.end, anchor(target, side));
  }
});

test('manual sides follow absolute position and resized card or group bounds without changing IDs', () => {
  const original = connectionSides(box(20, 30, 240, 160), box(800, 500, 400, 300), 'left', 'bottom');
  assert.deepEqual(original.start, { x: 20, y: 110 });
  assert.deepEqual(original.end, { x: 1000, y: 800 });
  const moved = connectionSides(box(1100, -70, 240, 160), box(-200, 900, 400, 300), 'left', 'bottom');
  assert.deepEqual(moved.start, { x: 1100, y: 10 });
  assert.deepEqual(moved.end, { x: 0, y: 1200 });
  const resized = connectionSides(box(1100, -70, 480, 320), box(-200, 900, 200, 150), 'left', 'bottom');
  assert.deepEqual(resized.start, { x: 1100, y: 90 });
  assert.deepEqual(resized.end, { x: -100, y: 1050 });
  assert.deepEqual([resized.from, resized.to], ['left', 'bottom']);
});

test('old, Agent and body-drop connections without IDs retain automatic routes in every layout', () => {
  const source = box();
  for (const target of [box(500, 50), box(-500, 50), box(20, 300), box(20, -300), box(40, 30)]) {
    for (const ids of [[undefined, undefined], [null, null]]) {
      assert.deepEqual(connectionSides(source, target, ...ids), facingSides(source, target));
    }
  }
});

test('unknown IDs fall back per endpoint while the other explicit side remains selected', () => {
  const source = box(), target = box(500, 100);
  assert.deepEqual(connectionSides(source, target, 'obsolete-port', 'unknown'), facingSides(source, target));
  const oneAssigned = connectionSides(source, target, 'left', 'obsolete-port');
  assert.deepEqual([oneAssigned.from, oneAssigned.to], ['left', 'left']);
  assert.deepEqual(oneAssigned.start, { x: 0, y: 50 });
  assert.deepEqual(oneAssigned.end, { x: 500, y: 150 });
});

test('actual addEdge retains different port pairs and reverse direction but deduplicates repeated pairs', () => {
  const make = (sourceHandle, targetHandle, source = 'a', target = 'b') => ({ source, target, sourceHandle, targetHandle });
  let edges = addEdge(make('left', 'left'), []);
  edges = addEdge(make('right', 'right'), edges);
  edges = addEdge(make('left', 'right'), edges);
  edges = addEdge(make('left', 'left', 'b', 'a'), edges);
  assert.equal(edges.length, 4); assert.equal(new Set(edges.map(edge => edge.id)).size, 4);
  const same = addEdge(make('left', 'left'), edges);
  assert.strictEqual(same, edges);
  const legacy = addEdge({ source: 'a', target: 'b', sourceHandle: null, targetHandle: null }, edges);
  assert.equal(legacy.length, 5);
  assert.strictEqual(addEdge({ source: 'a', target: 'b', sourceHandle: null, targetHandle: null }, legacy), legacy);
});

const edgeFixtures = () => [
  { id: 'left-left', source: 'a', target: 'b', sourceHandle: 'left', targetHandle: 'left', label: '支持' },
  { id: 'right-right', source: 'a', target: 'b', sourceHandle: 'right', targetHandle: 'right', label: '依赖' },
  { id: 'reverse', source: 'b', target: 'a', sourceHandle: 'top', targetHandle: 'bottom' },
  { id: 'unrelated', source: 'a', target: 'c', label: '验证' },
];

test('ambiguous Agent unlink supplies choices and leaves every input edge untouched', () => {
  const edges = edgeFixtures(), before = structuredClone(edges);
  assert.throws(() => disconnectEdges(edges, { from: 'a', to: 'b' }), error => {
    assert.match(error.message, /MULTIPLE_CONNECTIONS/);
    for (const id of ['left-left', 'right-right', 'reverse']) assert.ok(error.message.includes(id));
    assert.ok(!error.message.includes('unrelated'));
    return true;
  });
  assert.deepEqual(edges, before);
});

test('an explicit edge ID removes only that one line, retaining reverse and unrelated lines', () => {
  const edges = edgeFixtures();
  const remaining = disconnectEdges(edges, { edgeId: 'right-right', from: 'a', to: 'b' });
  assert.deepEqual(remaining.map(edge => edge.id), ['left-left', 'reverse', 'unrelated']);
  assert.strictEqual(remaining[0], edges[0]); assert.equal(edges.length, 4);
});

test('explicit all removes the pair in both directions and preserves unrelated lines', () => {
  const edges = edgeFixtures();
  assert.deepEqual(disconnectEdges(edges, { from: 'b', to: 'a', all: true }).map(edge => edge.id), ['unrelated']);
  assert.equal(edges.length, 4);
});

test('an invalid or mismatched edge ID never falls through to all-pair deletion', () => {
  const edges = edgeFixtures(), before = structuredClone(edges);
  assert.throws(() => disconnectEdges(edges, { edgeId: 'missing', from: 'a', to: 'b', all: true }), /找不到指定的连线/);
  assert.throws(() => disconnectEdges(edges, { edgeId: 'unrelated', from: 'a', to: 'b', all: true }), /连线编号与指定卡片不一致/);
  assert.throws(() => disconnectEdges(edges, { from: 'missing', to: 'b', all: true }), /没有连线/);
  assert.deepEqual(edges, before);
});

test('a sole legacy connection can be removed without an unnecessary ambiguity prompt', () => {
  const edges = [{ id: 'legacy', source: 'b', target: 'a', label: '拆解为' }, { id: 'other', source: 'b', target: 'c' }];
  assert.deepEqual(disconnectEdges(edges, { from: 'a', to: 'b' }).map(edge => edge.id), ['other']);
});

test('reverse label separation applies only to matching manual port routes or two legacy routes', () => {
  const edges = [
    { id: 'forward', source: 'a', target: 'b', sourceHandle: 'left', targetHandle: 'top', label: '支持' },
    { id: 'matching-reverse', source: 'b', target: 'a', sourceHandle: 'top', targetHandle: 'left', label: '依赖' },
    { id: 'different-reverse', source: 'b', target: 'a', sourceHandle: 'right', targetHandle: 'bottom', label: '验证' },
    { id: 'automatic-reverse', source: 'b', target: 'a', label: '导致' },
    { id: 'legacy-forward', source: 'c', target: 'd', label: '支持' },
    { id: 'legacy-reverse', source: 'd', target: 'c', sourceHandle: null, targetHandle: null, label: '依赖' },
    { id: 'no-label', source: 'b', target: 'a', sourceHandle: 'top', targetHandle: 'left' },
  ];
  assert.deepEqual([...lowerLabelEdges(edges)].sort(), ['legacy-reverse', 'matching-reverse']);
});

const actionsSource = await readFile(new URL('../src/actions.ts', import.meta.url), 'utf8');
const syntax = ts.createSourceFile('actions.ts', actionsSource, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
const names = new Set(['connect', 'record', 'travelHistory', 'serialize']);
const declarations = syntax.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text));
assert.equal(declarations.length, names.size, 'exercise the candidate action declarations rather than reimplementing them');
const code = ts.transpileModule(declarations.map(node => node.getText(syntax)).join('\n'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function actionsHarness() {
  let state = { historyVersion: 0, workspace: { id: 'memory-only', version: 1, nodes: [
    { id: 'a', position: { x: 0, y: 0 }, data: { kind: 'note', title: 'A', content: 'original' } },
    { id: 'b', position: { x: 400, y: 0 }, data: { kind: 'group', title: 'B', content: '' } },
  ], edges: [], viewport: { x: 0, y: 0, zoom: 0.64 }, messages: [], draftAttachments: [] } };
  const history = { past: [], future: [] };
  const context = { exports: {}, addEdge, structuredClone, history, groupResizeGesture: undefined,
    bindings: { flow: null }, cleanNodes: nodes => structuredClone(nodes),
    app: { get: () => state, set: patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; } },
    update: change => { state = { ...state, workspace: change(state.workspace) }; },
  };
  vm.runInNewContext(code + '\nexports.serialize = serialize;', context);
  return { ...context.exports, history, get: () => state };
}

test('actual connect preserves ports through serialized save content and full undo / redo', () => {
  const h = actionsHarness(), originalNodes = structuredClone(h.get().workspace.nodes);
  h.connect({ source: 'a', target: 'b', sourceHandle: 'left', targetHandle: 'left' });
  const first = plain(h.get().workspace.edges);
  h.connect({ source: 'a', target: 'b', sourceHandle: 'right', targetHandle: 'right' });
  const both = plain(h.get().workspace.edges);
  assert.equal(both.length, 2); assert.equal(h.history.past.length, 2);
  assert.deepEqual(both.map(edge => [edge.sourceHandle, edge.targetHandle]), [['left', 'left'], ['right', 'right']]);
  const reopened = JSON.parse(JSON.stringify(h.serialize(h.get().workspace, 2)));
  assert.deepEqual(reopened.edges, both); assert.deepEqual(reopened.nodes, originalNodes);
  h.travelHistory(false); assert.deepEqual(plain(h.get().workspace.edges), first);
  h.travelHistory(false); assert.deepEqual(plain(h.get().workspace.edges), []);
  h.travelHistory(true); assert.deepEqual(plain(h.get().workspace.edges), first);
  h.travelHistory(true); assert.deepEqual(plain(h.get().workspace.edges), both);
  assert.deepEqual(plain(h.get().workspace.nodes), originalNodes);
});

test('duplicate gestures and self-links leave both canvas content and undo history unchanged', () => {
  const h = actionsHarness();
  const connection = { source: 'a', target: 'b', sourceHandle: 'top', targetHandle: 'bottom' };
  h.connect(connection); h.travelHistory(false);
  assert.equal(h.history.future.length, 1);
  h.connect({ source: 'a', target: 'a', sourceHandle: 'left', targetHandle: 'right' });
  assert.equal(h.history.future.length, 1); assert.equal(h.history.past.length, 0);
  h.travelHistory(true);
  const edges = h.get().workspace.edges, before = plain(edges), past = h.history.past.length;
  h.connect(connection);
  assert.strictEqual(h.get().workspace.edges, edges);
  assert.deepEqual(plain(h.get().workspace.edges), before); assert.equal(h.history.past.length, past);
});

test('body-drop null handles remain automatic and coexist with a manually anchored connection', () => {
  const h = actionsHarness();
  h.connect({ source: 'a', target: 'b', sourceHandle: null, targetHandle: null });
  h.connect({ source: 'a', target: 'b', sourceHandle: 'left', targetHandle: 'left' });
  const [automatic, manual] = h.get().workspace.edges;
  assert.equal(automatic.sourceHandle, undefined); assert.equal(automatic.targetHandle, undefined);
  assert.deepEqual(connectionSides(box(), box(400, 0), automatic.sourceHandle, automatic.targetHandle), facingSides(box(), box(400, 0)));
  assert.deepEqual([manual.sourceHandle, manual.targetHandle], ['left', 'left']);
  assert.equal(h.history.past.length, 2);
});
