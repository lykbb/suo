import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
const source = await readFile(new URL('../public/reader-events.js', import.meta.url), 'utf8');
function reader(mode = 'reader') {
  const handlers = new Map(), windowHandlers = new Map(), messages = [], styles = [];
  const root = { dataset: {} }, parent = { postMessage: (data, origin) => messages.push({ data: JSON.parse(JSON.stringify(data)), origin }) };
  let cleared = 0;
  runInNewContext(source, {
    document: { currentScript: { dataset: { channel: 'opaque-frame-token', mode } }, documentElement: root, createElement: () => ({}), head: { append: style => styles.push(style.textContent) }, addEventListener: (name, handler, options) => handlers.set(name, { handler, options }) },
    window: { getSelection: () => ({ removeAllRanges: () => cleared++ }), addEventListener: (name, handler) => windowHandlers.set(name, handler) },
    parent,
  });
  return { handlers, windowHandlers, messages, root, parent, styles, cleared: () => cleared };
}
test('ordinary file scrolling remains native; pinch or modifier wheel is forwarded once', () => {
  const { handlers, messages } = reader();
  let prevented = 0;
  const wheel = { ctrlKey: false, metaKey: false, clientX: 91, clientY: 150, deltaY: 8, deltaMode: 0, preventDefault: () => prevented++ };
  handlers.get('wheel').handler(wheel);
  assert.equal(messages.length, 0); assert.equal(prevented, 0);
  handlers.get('wheel').handler({ ...wheel, ctrlKey: true });
  assert.equal(prevented, 1); assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].data, { channel: 'opaque-frame-token', type: 'reader-zoom', x: 91, y: 150, delta: 8, deltaMode: 0 });
  assert.equal(handlers.get('wheel').options.passive, false);
  handlers.get('wheel').handler({ ...wheel, metaKey: true });
  assert.equal(messages.length, 2);
});
test('file-body activation preserves modifier selection without consuming pointer input', () => {
  const { handlers, messages } = reader();
  handlers.get('pointerdown').handler({ shiftKey: true, ctrlKey: false, metaKey: false });
  assert.deepEqual(messages[0].data, { channel: 'opaque-frame-token', type: 'reader-activate', shiftKey: true, ctrlKey: false, metaKey: false });
});
test('compact document select-all requests cards, while reader and editable fields keep native text selection', () => {
  for (const key of ['ctrlKey', 'metaKey']) {
    const preview = reader('compact');
    let prevented = 0;
    const event = { key: 'a', [key]: true, altKey: false, target: { closest: () => null }, preventDefault: () => prevented++ };
    preview.handlers.get('keydown').handler(event);
    assert.equal(prevented, 1); assert.equal(preview.cleared(), 1);
    assert.deepEqual(preview.messages[0].data, { channel: 'opaque-frame-token', type: 'reader-select-all' });
    const expanded = reader(); expanded.handlers.get('keydown').handler(event);
    assert.equal(prevented, 1); assert.equal(expanded.messages.length, 0);
    preview.handlers.get('keydown').handler({ ...event, target: { closest: () => ({ tagName: 'INPUT' }) } });
    assert.equal(prevented, 1); assert.equal(preview.messages.length, 1);
  }
});
test('compact document double-click clears browser word selection and opens its reader', () => {
  const preview = reader('compact');
  preview.handlers.get('dblclick').handler({ target: { closest: () => null } });
  assert.equal(preview.cleared(), 1);
  assert.deepEqual(preview.messages[0].data, { channel: 'opaque-frame-token', type: 'reader-open' });
});
test('compact iframe rejects native text selection while expanded reader and compact inputs preserve it', () => {
  for (const mode of ['compact', 'reader']) {
    const preview = reader(mode); let prevented = 0;
    preview.handlers.get('selectstart').handler({ target: { closest: () => null }, preventDefault: () => prevented++ });
    assert.equal(prevented, mode === 'compact' ? 1 : 0);
    preview.handlers.get('selectstart').handler({ target: { closest: () => ({ tagName: 'INPUT' }) }, preventDefault: () => prevented++ });
    assert.equal(prevented, mode === 'compact' ? 1 : 0);
    assert.equal(preview.root.dataset.suoCompact, mode === 'compact' ? 'true' : undefined);
    assert.match(preview.styles[0], /-webkit-user-select:none!important/);
  }
});
test('iframe temporary lock accepts only its parent and channel, then restores expanded text selection', () => {
  const preview = reader(); const receive = preview.windowHandlers.get('message');
  const data = { channel: 'opaque-frame-token', type: 'reader-selection-lock', locked: true };
  for (const event of [{ source: {}, data }, { source: preview.parent, data: { ...data, channel: 'wrong' } }, { source: preview.parent, data: { ...data, locked: 'yes' } }]) receive(event);
  assert.equal(preview.root.dataset.suoSelectionLocked, undefined);
  receive({ source: preview.parent, data }); assert.equal(preview.root.dataset.suoSelectionLocked, 'true');
  let prevented = 0; preview.handlers.get('selectstart').handler({ target: { closest: () => null }, preventDefault: () => prevented++ }); assert.equal(prevented, 1);
  receive({ source: preview.parent, data: { ...data, locked: false } }); assert.equal(preview.root.dataset.suoSelectionLocked, undefined);
  preview.handlers.get('selectstart').handler({ target: { closest: () => null }, preventDefault: () => prevented++ }); assert.equal(prevented, 1);
});
