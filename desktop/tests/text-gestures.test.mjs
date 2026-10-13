import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const source = name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');
const [selectionSource, panelSource, canvasSource, appSource, css] = await Promise.all(['selection.ts', 'FloatingPanel.tsx', 'Canvas.tsx', 'App.tsx', 'styles.css'].map(source));

function harness() {
  const documentHandlers = new Map(), windowHandlers = new Map(), classes = new Set(), effects = [], frames = [];
  const on = handlers => (name, fn) => { const list = handlers.get(name) ?? new Set(); list.add(fn); handlers.set(name, list); };
  const off = handlers => (name, fn) => handlers.get(name)?.delete(fn);
  const emit = (handlers, name, event = {}) => { for (const fn of [...(handlers.get(name) ?? [])]) fn(event); };
  let selection = { rangeCount: 0, isCollapsed: true }, cleared = 0, focused = 0, saved = 0;
  const calls = { prevented: 0, stopped: 0, captured: 0, toggled: 0, ungrouped: 0 };
  const state = { workspace: { id: 'session', nodes: [], edges: [], panels: {}, panelLayers: {} }, stage: { width: 1000, height: 700 }, tool: 'select', drawingOpen: false, popup: '', editor: null };
  const document = { documentElement: { classList: { add: x => classes.add(x), remove: x => classes.delete(x) } }, querySelectorAll: () => frames, addEventListener: on(documentHandlers), removeEventListener: off(documentHandlers) };
  const window = { getSelection: () => ({ ...selection, removeAllRanges: () => { cleared++; selection = { rangeCount: 0, isCollapsed: true }; } }), addEventListener: on(windowHandlers), removeEventListener: off(windowHandlers), setTimeout, clearTimeout };
  const ctx = { exports: {}, document, window, Symbol, Array, requestAnimationFrame: () => 1, cancelAnimationFrame() {}, Element: class {} };
  const compile = code => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(compile(selectionSource), ctx); const selectionApi = ctx.exports;
  const actions = { focusPanel: () => focused++, panelChange() {}, pinPanel() {}, saveViewport: () => saved++, toggleGroupSelected: () => calls.toggled++, ungroupSelected: () => calls.ungrouped++, finishNodeDrag() {} };
  const react = { useRef: value => ({ current: value }), useEffect: fn => effects.push(fn), useMemo: fn => fn(), useState: value => [value, () => {}] };
  const runtime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
  const modules = { react, 'react/jsx-runtime': runtime, 'motion/react': { motion: { section: 'section', div: 'div' }, AnimatePresence: 'presence' }, '@xyflow/react': { ReactFlow: 'flow', SelectionMode: { Partial: 'partial' }, ConnectionMode: { Loose: 'loose' }, BackgroundVariant: {}, ViewportPortal: 'portal', MarkerType: { ArrowClosed: 'arrowclosed' }, Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' } }, './cardLinks': { RELATIONS: [], facingSides: () => ({}) }, './selection': selectionApi, './actions': actions, './state': { app: { use: fn => fn(state), get: () => state }, hasThreadOf: () => false, isWelcomeOf: () => false }, './layers': { panelZ: () => 23, orderCards: nodes => nodes }, './preferences': { preferences: { use: fn => fn({ background: 'plain' }) } }, './readerMessage': { wheelPixels: x => x } };
  ctx.require = name => modules[name] ?? {};
  const load = code => { ctx.exports = {}; vm.runInNewContext(compile(code), ctx); return ctx.exports; };
  const region = { contains: node => node === 'content' };
  const text = { closest: selector => selector.includes('.message') ? region : null };
  const input = { closest: selector => selector.includes('input') ? {} : null };
  const blank = { closest: () => null };
  const event = (target = text, extra = {}) => ({ target, pointerId: 1, button: 0, buttons: 1, clientX: 100, clientY: 100, currentTarget: { setPointerCapture: () => calls.captured++ }, preventDefault: () => calls.prevented++, stopPropagation: () => calls.stopped++, ...extra });
  return { load, ctx, state, actions, selectionApi, effects, documentHandlers, windowHandlers, classes, frames, region, text, input, blank, event, calls, emit, setSelection: patch => { selection = { rangeCount: 1, isCollapsed: false, anchorNode: 'content', focusNode: 'content', ...patch }; }, cleared: () => cleared, focused: () => focused, saved: () => saved };
}

function panelHarness() {
  const h = harness(); const Panel = h.load(panelSource).default;
  h.panel = Panel({ name: 'thread', label: '对话', rect: { x: 0, y: 0, width: 300, height: 400 } });
  h.cleanup = h.effects.map(fn => fn()); return h;
}

test('a single content click clears the old range and any new accidental whole-content selection without starting a panel drag', () => {
  const h = panelHarness(); h.setSelection(); h.panel.props.onPointerDownCapture(h.event());
  assert.equal(h.cleared(), 1); assert.equal(h.focused(), 0); assert.equal(h.calls.prevented, 0); assert.equal(h.calls.captured, 0);
  h.emit(h.documentHandlers, 'pointerup', h.event()); assert.equal(h.focused(), 1);
  h.setSelection(); h.panel.props.onClickCapture(h.event(h.text, { detail: 1 })); assert.equal(h.cleared(), 2);
  h.cleanup.forEach(fn => fn?.());
});

test('actual message drag selection, double-click word selection, and editable fields remain native', () => {
  const h = panelHarness(); h.panel.props.onPointerDownCapture(h.event());
  h.emit(h.documentHandlers, 'pointermove', h.event(h.text, { clientX: 120 })); h.emit(h.documentHandlers, 'pointerup', h.event());
  h.setSelection(); h.panel.props.onClickCapture(h.event(h.text, { detail: 1 })); assert.equal(h.cleared(), 0);
  h.panel.props.onPointerDownCapture(h.event()); const before = h.cleared(); h.setSelection();
  h.panel.props.onClickCapture(h.event(h.text, { detail: 2 })); assert.equal(h.cleared(), before);
  h.panel.props.onPointerDownCapture(h.event(h.input)); assert.equal(h.cleared(), before); assert.equal(h.classes.size, 0); assert.equal(h.calls.prevented, 0);
  h.cleanup.forEach(fn => fn?.());
});

test('gesture lock is temporary, survives nested gestures, clears sandbox readers through their channel, and tolerates opaque origins', () => {
  const h = harness(), messages = [];
  h.frames.push({ dataset: { readerChannel: 'frame-channel' }, contentWindow: { postMessage: data => messages.push(data), getSelection: () => { throw new Error('opaque origin'); } } });
  h.setSelection(); const first = h.selectionApi.suppressTextSelection(), second = h.selectionApi.suppressTextSelection();
  assert.equal(h.cleared(), 1); assert(h.classes.has('suo-text-gesture')); assert.equal(messages.at(-1).locked, true);
  h.emit(h.documentHandlers, 'selectstart', { preventDefault: () => h.calls.prevented++ }); assert.equal(h.calls.prevented, 1);
  first(); first(); assert(h.classes.has('suo-text-gesture')); second(); assert.equal(h.classes.size, 0); assert.equal(messages.at(-1).locked, false);
  h.setSelection(); h.emit(h.documentHandlers, 'selectionchange'); assert.equal(h.cleared(), 1);
});

test('panel move cancellation and window blur release native selection lock', () => {
  const h = panelHarness(); h.panel.props.onPointerDownCapture(h.event(h.blank)); assert(h.classes.has('suo-text-gesture'));
  h.panel.props.onPointerCancel(); assert.equal(h.classes.size, 0);
  h.panel.props.onPointerDownCapture(h.event(h.blank)); h.emit(h.windowHandlers, 'blur'); assert.equal(h.classes.size, 0);
  h.cleanup.forEach(fn => fn?.());
});

test('canvas pointer and viewport gestures lock selection, preserve editor input, and release on up, cancel, blur, and cleanup', () => {
  const h = harness(), Canvas = h.load(canvasSource).default, tree = Canvas(), handlers = new Map();
  tree.props.ref.current = { addEventListener: (name, fn) => handlers.set(name, fn), removeEventListener: name => handlers.delete(name), clientHeight: 700 };
  const cleanup = h.effects.map(fn => fn());
  handlers.get('pointerdown')(h.event(h.input)); assert.equal(h.classes.size, 0);
  for (const finish of ['pointerup', 'pointercancel']) { handlers.get('pointerdown')(h.event(h.blank)); assert(h.classes.has('suo-text-gesture')); h.emit(h.windowHandlers, finish); assert.equal(h.classes.size, 0); }
  const flow = tree.props.children; assert.equal(flow.props.onNodeDragStop, h.actions.finishNodeDrag);
  flow.props.onMoveStart(); assert(h.classes.has('suo-text-gesture')); flow.props.onMoveEnd(null, {}); assert.equal(h.classes.size, 0); assert.equal(h.saved(), 1);
  handlers.get('pointerdown')(h.event(h.blank)); h.emit(h.windowHandlers, 'blur'); assert.equal(h.classes.size, 0);
  handlers.get('pointerdown')(h.event(h.blank)); cleanup.forEach(fn => fn?.()); assert.equal(h.classes.size, 0);
});

test('Ctrl/Cmd+G toggles once, key repeat is consumed, and Shift+G ungroups once', () => {
  for (const modifier of ['metaKey', 'ctrlKey']) {
    const h = harness(); h.ctx.useEffect = fn => fn(); h.ctx.app = { get: () => h.state }; h.ctx.isWelcomeOf = () => false;
    Object.assign(h.ctx, h.selectionApi, h.actions);
    const shortcuts = appSource.slice(appSource.indexOf('function useShortcuts()'), appSource.indexOf('function useStageSize'));
    h.load(shortcuts + '\nuseShortcuts();');
    const press = { key: 'g', [modifier]: true, target: null, preventDefault: () => h.calls.prevented++, stopPropagation: () => h.calls.stopped++ };
    h.emit(h.documentHandlers, 'keydown', press); h.emit(h.documentHandlers, 'keydown', { ...press, repeat: true });
    h.emit(h.documentHandlers, 'keydown', { ...press, shiftKey: true }); h.emit(h.documentHandlers, 'keydown', { ...press, shiftKey: true, repeat: true });
    assert.equal(h.calls.toggled, 1); assert.equal(h.calls.ungrouped, 1); assert.equal(h.calls.prevented, 4); assert.equal(h.calls.stopped, 4);
  }
});

test('compact card reader and temporary gesture CSS include WebKit protection while message/expanded reading restores selection', () => {
  assert.match(css, /\.work-card:not\(\.editing\) \.card-reader \*\{[^}]*user-select:none;[^}]*-webkit-user-select:none/);
  assert.match(css, /\.message \.card-markdown,\.reader-panel \.card-text,\.reader-panel \.card-markdown\{[^}]*user-select:text;[^}]*-webkit-user-select:text/);
  assert.match(css, /html\.suo-text-gesture \*\{[^}]*user-select:none!important;[^}]*-webkit-user-select:none!important/);
  assert.match(css, /html\.suo-text-gesture iframe\{ pointer-events:none!important/);
});
