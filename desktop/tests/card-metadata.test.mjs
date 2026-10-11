import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const desktop = process.env.SUO_METADATA_DESKTOP ?? fileURLToPath(new URL('../', import.meta.url));
const sourceRoot = process.env.SUO_METADATA_SOURCE ?? join(desktop, 'src');
const { createTestDirectory } = await import(pathToFileURL(join(desktop, 'tests/helpers/test-data.mjs')));
const { WorkspaceStore } = await import(pathToFileURL(join(desktop, 'bridge/store.mjs')));
const metadata = await import(pathToFileURL(join(sourceRoot, 'cardMetadata.ts')));
const { cleanNodes, groupCards, ungroupCards } = await import(pathToFileURL(join(desktop, 'src/geometry.ts')));
const { orderCards } = await import(pathToFileURL(join(desktop, 'src/layers.ts')));
const { CARD_COLORS, normalizeCardColor, readCardTags, metadataPatch, cardMetadataStyle, colorInk } = metadata;
const plain = value => JSON.parse(JSON.stringify(value));
const source = await readFile(join(sourceRoot, 'actions.ts'), 'utf8');
const syntax = ts.createSourceFile('actions.ts', source, ts.ScriptTarget.ES2022, true);
const names = new Set(['updateCardMetadata', 'update', 'record', 'travelHistory', 'serialize', 'commitCard', 'pinCard']);
const declarations = syntax.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text));
assert.equal(declarations.length, names.size, 'exercise the actual metadata, save and undo functions');
const code = ts.transpileModule(declarations.map(node => node.getText(syntax)).join('\n'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function harness() {
  const kinds = ['note', 'document', 'file', 'drawing', 'group'];
  let state = { historyVersion: 0, workspace: { id: 'card-metadata-test', title: '卡片分类验收', version: 0, updatedAt: '', panels: {}, messages: [], edges: [], nodes: kinds.map((kind, index) => ({ id: kind, type: kind === 'group' ? 'group' : 'card', position: { x: index * 350, y: 0 }, selected: false, data: { kind, title: kind, content: '原始正文', ...(kind === 'file' ? { asset: { id: 'fixture-asset', name: '资料.txt', kind: 'text', mime: 'text/plain', size: 12, text: '原始附件' } } : {}) } })) } };
  const history = { past: [], future: [] }, session = { dirty: false };
  const notices = [];
  const context = { exports: {}, history, session, groupResizeGesture: undefined, metadataPatch, cleanNodes, orderCards, structuredClone,
    notice: message => notices.push(message), scheduleSave: () => {}, isWelcomeOf: () => false,
    app: { get: () => state, set: patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; } },
  };
  vm.runInNewContext(code + '\nexports.serialize = serialize;', context);
  return { ...context.exports, get: () => state, history, session, notices };
}
test('colors normalize short and long hex values and reject CSS injection', () => {
  assert.equal(normalizeCardColor(' #AbC '), '#aabbcc');
  assert.equal(normalizeCardColor('#DBEAFE'), '#dbeafe');
  for (const value of ['red', '#12345', 'url(https://example.test)', '#fff; color:red', null, 8]) assert.equal(normalizeCardColor(value), undefined);
  assert.equal(cardMetadataStyle('invalid'), undefined);
});
test('preset and custom colors retain readable text contrast', () => {
  for (const color of [...CARD_COLORS.map(item => item.value).filter(Boolean), '#000', '#123456', '#777777', '#fff']) {
    const fill = normalizeCardColor(color), ink = colorInk(color);
    const linear = [1, 3, 5].map(index => { const value = parseInt(fill.slice(index, index + 2), 16) / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; });
    const luminance = linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
    assert.ok((ink === '#000000' ? (luminance + .05) / .05 : 1.05 / (luminance + .05)) >= 4.5, `${color} needs readable text`);
    assert.equal(cardMetadataStyle(color)['--card-base-ink'], ink);
  }
});
test('tags trim spaces, deduplicate case and safely ignore malformed old values', () => {
  assert.deepEqual(readCardTags(['  待验证 ', '待验证', 'PRD', 'prd', '用户\n访谈', '', 8, null]), ['待验证', 'PRD', '用户 访谈']);
  assert.deepEqual(readCardTags(null), []);
  assert.equal(readCardTags(Array.from({ length: 12 }, (_, index) => `标签${index}`)).length, 8);
});
test('invalid colors or excessive tags cannot change existing metadata', () => {
  const data = { title: '旧内容', content: '', kind: 'note', color: '#fff', tags: ['旧标签'] };
  for (const change of [{ color: 'red' }, { color: 1 }, { tags: ['x'.repeat(33)] }, { tags: Array.from({ length: 9 }, (_, index) => `${index}`) }, { tags: [null] }]) assert.throws(() => metadataPatch(data, change));
  assert.deepEqual(data.tags, ['旧标签']);
  assert.equal(metadataPatch(data, { color: null }).color, undefined);
});
test('every block type updates independently without replacing content or attachments', () => {
  const h = harness();
  for (const kind of ['note', 'document', 'file', 'drawing', 'group']) {
    assert.equal(h.updateCardMetadata(kind, { color: '#DBEAFE', tags: ['待验证'] }), true);
    const card = h.get().workspace.nodes.find(node => node.id === kind);
    assert.equal(card.data.color, '#dbeafe'); assert.equal(card.data.content, '原始正文');
  }
  assert.equal(h.get().workspace.nodes.find(node => node.id === 'file').data.asset.text, '原始附件');
  h.updateCardMetadata('note', { color: '#000', tags: ['已确认'] });
  assert.deepEqual(plain(h.get().workspace.nodes.find(node => node.id === 'document').data.tags), ['待验证']);
});
test('color and tag edits undo and redo together, including reset and removal', () => {
  const h = harness();
  h.updateCardMetadata('note', { color: '#dcfce7', tags: ['待验证', '访谈'] });
  h.travelHistory(false);
  assert.equal(h.get().workspace.nodes[0].data.color, undefined); assert.equal(h.get().workspace.nodes[0].data.tags, undefined);
  h.travelHistory(true);
  assert.deepEqual(plain(h.get().workspace.nodes[0].data.tags), ['待验证', '访谈']);
  h.updateCardMetadata('note', { color: null, tags: [] });
  assert.equal(h.get().workspace.nodes[0].data.color, undefined); assert.deepEqual(plain(h.get().workspace.nodes[0].data.tags), []);
  h.travelHistory(false); assert.equal(h.get().workspace.nodes[0].data.color, '#dcfce7');
});
test('no-op, missing card and invalid edits do not create undo steps or dirty saves', () => {
  const h = harness();
  assert.equal(h.updateCardMetadata('missing', { color: '#fff' }), false);
  assert.equal(h.updateCardMetadata('note', { color: null, tags: [] }), true);
  assert.equal(h.updateCardMetadata('note', { color: 'invalid' }), false);
  assert.equal(h.history.past.length, 0); assert.equal(h.session.dirty, false); assert.equal(h.notices.length, 1);
});
test('editing and pinning cards preserve color and labels', () => {
  const h = harness();
  h.updateCardMetadata('note', { color: '#fef3c7', tags: ['重点'] });
  h.commitCard('note', '新的标题', '人工补充正文'); h.pinCard('note');
  const data = h.get().workspace.nodes.find(node => node.id === 'note').data;
  assert.equal(data.color, '#fef3c7'); assert.deepEqual(plain(data.tags), ['重点']);
  assert.equal(data.content, '人工补充正文'); assert.equal(data.pinned, true);
});
test('grouping and ungrouping preserve each child classification', () => {
  const h = harness();
  h.updateCardMetadata('note', { color: '#fef3c7', tags: ['用户想法'] });
  h.updateCardMetadata('document', { color: '#dbeafe', tags: ['PRD'] });
  const nodes = h.get().workspace.nodes.map(node => ({ ...node, selected: ['note', 'document'].includes(node.id) }));
  const grouped = groupCards(nodes, 'group-new');
  const restored = ungroupCards(grouped, 'group-new');
  for (const id of ['note', 'document']) assert.deepEqual(restored.find(node => node.id === id).data, nodes.find(node => node.id === id).data);
});
test('serialized metadata survives the real workspace store save and reload', async () => {
  const h = harness();
  for (const kind of ['note', 'document', 'file', 'drawing', 'group']) h.updateCardMetadata(kind, { color: '#ede9fe', tags: ['保存验收'] });
  const root = await createTestDirectory('card-metadata-');
  const store = new WorkspaceStore(root, { trashRoot: process.env.SUO_TEST_TRASH_ROOT });
  const serialized = h.serialize(h.get().workspace, 0), saved = await store.save(serialized, 0);
  const loaded = await new WorkspaceStore(root).load(saved.id);
  for (const node of loaded.nodes) { assert.equal(node.data.color, '#ede9fe'); assert.deepEqual(node.data.tags, ['保存验收']); assert.equal(node.data.content, '原始正文'); }
  assert.equal(loaded.nodes.find(node => node.id === 'file').data.asset.id, 'fixture-asset');
  h.updateCardMetadata('note', { color: null, tags: [] });
  await store.save(h.serialize(h.get().workspace, saved.version), saved.version);
  const reset = (await store.load(saved.id)).nodes.find(node => node.id === 'note');
  assert.equal(reset.data.color, undefined); assert.deepEqual(reset.data.tags, []);
});
