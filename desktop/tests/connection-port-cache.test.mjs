import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { XYHandle, ConnectionMode, Position, updateNodeInternals } from '@xyflow/system';

const SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left];
const dimensions = { width: 200, height: 100 };
const points = { top: [100, 0], right: [200, 50], bottom: [100, 100], left: [0, 50] };
const plain = value => JSON.parse(JSON.stringify(value));

function fixture(id = 'card') {
  const listeners = new Map(), frames = [];
  let state = null, starts = 0, ends = 0, refreshes = 0;
  const doc = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: type => listeners.delete(type),
    querySelector: () => null,
    elementFromPoint: () => null,
  };
  const handles = SIDES.map(side => ({
    offsetWidth: 24, offsetHeight: 24,
    classList: { contains: name => name === 'source' },
    getRootNode: () => doc,
    getAttribute: key => ({ 'data-handleid': side, 'data-handlepos': side, 'data-nodeid': id })[key] ?? null,
    getBoundingClientRect: () => ({ left: points[side][0] - 12, top: points[side][1] - 12 }),
  }));
  const nodeElement = {
    offsetWidth: dimensions.width, offsetHeight: dimensions.height,
    querySelectorAll: selector => selector === '.source' ? handles : [],
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  };
  const node = { id, position: { x: 0, y: 0 }, measured: { ...dimensions }, internals: {
    positionAbsolute: { x: 0, y: 0 },
    handleBounds: {
      source: [{ id: null, nodeId: id, type: 'source', position: Position.Right, x: 200, y: 50, width: 0, height: 0 }],
      target: [{ id: null, nodeId: id, type: 'target', position: Position.Left, x: 0, y: 50, width: 0, height: 0 }],
    },
  } };
  const nodeLookup = new Map([[id, node]]), parentLookup = new Map();
  const container = {
    querySelector: selector => selector === '.xyflow__viewport' ? {}
      : selector === `.react-flow__node[data-id="${id}"]` ? nodeElement : null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 600 }),
  };
  const windowStub = {
    document: doc,
    getComputedStyle: () => ({ transform: 'matrix(1,0,0,1,0,0)' }),
    DOMMatrixReadOnly: class { m22 = 1; },
  };
  function withGlobals(run) {
    const keys = ['window', 'cancelAnimationFrame'];
    const before = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, 'window', { value: windowStub, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'cancelAnimationFrame', { value: () => {}, configurable: true, writable: true });
    try { return run(); }
    finally { keys.forEach((key, index) => before[index]
      ? Object.defineProperty(globalThis, key, before[index]) : delete globalThis[key]); }
  }
  function measure(force) {
    return withGlobals(() => updateNodeInternals(new Map([[id, { id, nodeElement, force }]]),
      nodeLookup, parentLookup, container, [0, 0], undefined, 'auto'));
  }
  function drag(side) {
    const element = handles[SIDES.indexOf(side)];
    return withGlobals(() => {
      const event = { target: element, clientX: points[side][0], clientY: points[side][1], button: 0 };
      XYHandle.onPointerDown(event, {
        connectionMode: ConnectionMode.Loose, connectionRadius: 32, handleId: side,
        nodeId: id, isTarget: false, domNode: container, nodeLookup, lib: 'react',
        autoPanOnConnect: false, flowId: 'suo', panBy: () => {},
        cancelConnection: () => { state = null; },
        onConnectStart: () => { starts++; }, onConnectEnd: () => { ends++; },
        updateConnection: value => { state = value; }, getTransform: () => [0, 0, 1],
        getFromHandle: () => state?.fromHandle, autoPanSpeed: 15, dragThreshold: 0,
        handleDomNode: element,
      });
      const started = state?.fromHandle.id ?? null;
      if (state) listeners.get('mouseup')?.(event);
      assert.equal(listeners.size, 0, 'finished or rejected drag must leave no document listeners');
      return started;
    });
  }
  const store = { getState: () => ({ domNode: container, updateNodeInternals: updates => {
    refreshes++;
    return withGlobals(() => updateNodeInternals(updates, nodeLookup, parentLookup,
      container, [0, 0], undefined, 'auto'));
  } }) };
  return {
    id, nodeLookup, listeners, frames, measure, drag, store,
    requestAnimationFrame: callback => { frames.push(callback); return frames.length; },
    flushFrames: () => { while (frames.length) frames.shift()(); },
    counts: () => ({ starts, ends, refreshes }),
  };
}

test('four named current ports cannot start a drag from an old two-port cache', () => {
  const h = fixture();
  const before = structuredClone(h.nodeLookup.get(h.id));
  assert.deepEqual(SIDES.map(h.drag), [null, null, null, null]);
  assert.deepEqual(h.counts(), { starts: 0, ends: 0, refreshes: 0 });
  assert.deepEqual(h.nodeLookup.get(h.id), before);
});

test('unchanged node size alone does not invalidate cached unnamed ports', () => {
  const h = fixture();
  assert.equal(h.measure(false).updatedInternals, false);
  assert.deepEqual(SIDES.map(h.drag), [null, null, null, null]);
  assert.deepEqual(h.nodeLookup.get(h.id).internals.handleBounds.source.map(handle => handle.id), [null]);
});

test('a forced measurement registers all four sides and restores real drag initialization', () => {
  const h = fixture();
  const measured = h.measure(true);
  assert.equal(measured.updatedInternals, true);
  assert.deepEqual(measured.changes, [], 'port registration must not resize the card');
  assert.deepEqual(h.nodeLookup.get(h.id).measured, dimensions);
  assert.deepEqual(h.nodeLookup.get(h.id).position, { x: 0, y: 0 });
  assert.deepEqual(h.nodeLookup.get(h.id).internals.handleBounds.source.map(handle => handle.id), SIDES);
  assert.deepEqual(SIDES.map(h.drag), SIDES);
  assert.deepEqual(h.counts(), { starts: 4, ends: 4, refreshes: 0 });
});

const candidateUrl = new URL('../src/CardNode.tsx', import.meta.url);
const candidateSource = await readFile(candidateUrl, 'utf8');
const candidateAst = ts.createSourceFile('CardNode.tsx', candidateSource,
  ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
const declarations = candidateAst.statements.filter(statement => ts.isVariableStatement(statement)
  && statement.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name)
    && ['PORTS', 'Ports'].includes(declaration.name.text)));
assert.equal(declarations.length, 2, 'exercise actual PORTS and Ports declarations');
const portsCode = ts.transpileModule(declarations.map(node => node.getText(candidateAst)).join('\n'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const reactFlowSource = await readFile(new URL(import.meta.resolve('@xyflow/react')), 'utf8');
const reactFlowAst = ts.createSourceFile('react-flow.js', reactFlowSource, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
const actualUpdateHook = reactFlowAst.statements.find(node => ts.isFunctionDeclaration(node)
  && node.name?.text === 'useUpdateNodeInternals');
assert.ok(actualUpdateHook, 'use the installed hook implementation instead of a mirrored update function');

function mountPorts(h) {
  const effects = [];
  const jsxRuntime = { Fragment: Symbol('Fragment'), jsx: (type, props) => ({ type, props }),
    jsxs: (type, props) => ({ type, props }) };
  const context = {
    exports: {}, Position, Handle: Symbol('Handle'), memo: component => component,
    useCallback: callback => callback, useStoreApi: () => h.store,
    useEffect: effect => effects.push(effect), useNodeId: () => h.id,
    requestAnimationFrame: h.requestAnimationFrame,
    require: name => { assert.equal(name, 'react/jsx-runtime'); return jsxRuntime; },
  };
  vm.runInNewContext(actualUpdateHook.getText(reactFlowAst) + '\n' + portsCode
    + '\nexports.Ports = Ports;', context);
  const tree = context.exports.Ports({ id: h.id });
  const children = Array.isArray(tree.props.children) ? tree.props.children : [tree.props.children];
  assert.deepEqual(plain(children.map(child => ({ id: child.props.id, type: child.props.type,
    position: child.props.position }))), SIDES.map(side => ({ id: side, type: 'source', position: side })));
  effects.forEach(effect => effect());
  return effects;
}

for (const id of ['card', 'group']) test(`actual Ports mounting refreshes ${id} cache before any node resize`, () => {
  const h = fixture(id);
  assert.deepEqual(SIDES.map(h.drag), [null, null, null, null]);
  assert.ok(mountPorts(h).length > 0, 'mounting Ports must schedule an internal update');
  assert.equal(h.frames.length, 1, 'the installed hook schedules one forced registration');
  h.flushFrames();
  assert.deepEqual(SIDES.map(h.drag), SIDES);
  assert.deepEqual(h.counts(), { starts: 4, ends: 4, refreshes: 1 });
  assert.deepEqual(h.nodeLookup.get(h.id).measured, dimensions);
  h.measure(true);
  assert.deepEqual(SIDES.map(h.drag), SIDES, 'repeated registration keeps stable port IDs usable');
  assert.equal(h.listeners.size, 0);
});
