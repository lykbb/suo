import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import { createTestDirectory } from './helpers/test-data.mjs';
import { WorkspaceStore } from '../bridge/store.mjs';
import { FileStore } from '../bridge/files.mjs';
import { assertSaveRequest, committedReplay, committedState, workspaceAssetIds } from '../bridge/saveReceipt.mjs';

async function storeFixture() {
  const root = await createTestDirectory('save-receipt-');
  return { root, store: new WorkspaceStore(root) };
}
const copy = value => JSON.parse(JSON.stringify(value));

test('a real committed native save with a lost acknowledgement replays once before and after store restart', async () => {
  const { root, store } = await storeFixture(), first = await store.create();
  const request = { ...first, draft: '保存成功但确认丢失', draftAttachments: [{ id: 'draft-file', name: '资料.md' }] }, requestId = 'lost-ack';
  await assert.rejects((async () => { await store.save(request, first.version, { requestId }); throw new Error('模拟提交后网络确认丢失'); })(), /确认丢失/u);
  const committed = await store.load(first.id); assert.equal(committed.version, first.version + 1); assert.equal(committed.saveReceipt.id, requestId);
  const sameProcess = await store.save(request, first.version, { requestId }); assert.deepEqual(sameProcess, committed);
  const restarted = new WorkspaceStore(root), afterRestart = await restarted.save(copy(request), first.version, { requestId }); assert.deepEqual(afterRestart, committed);
  assert.equal((await readdir(store.folder(first.id))).filter(name => /^\d{10}\.json$/u.test(name)).length, 2);
  assert.equal(afterRestart.updatedAt, committed.updatedAt); assert.deepEqual(afterRestart.draftAttachments, request.draftAttachments);
});

test('the native receipt refuses the same request id with changed content or a different base version', async () => {
  const { store } = await storeFixture(), first = await store.create(), request = { ...first, draft: '原始内容' }, requestId = 'same-request';
  const saved = await store.save(request, first.version, { requestId });
  await assert.rejects(store.save({ ...request, draft: '不同内容' }, first.version, { requestId }), /同一个保存请求包含不同内容/u);
  await assert.rejects(store.save(request, saved.version, { requestId }), /同一个保存请求包含不同内容/u);
  assert.deepEqual(await store.load(first.id), saved);
});

test('a real different native writer prevents an old acknowledged-or-lost request from overwriting its newer commit', async () => {
  const { root, store } = await storeFixture(), first = await store.create(), request = { ...first, draft: '窗口A草稿' }, requestId = 'window-A';
  const a = await store.save(request, first.version, { requestId }), other = new WorkspaceStore(root);
  const b = await other.save({ ...a, draft: '窗口B更新内容' }, a.version, { requestId: 'window-B' });
  await assert.rejects(store.save(request, first.version, { requestId }), /另一个窗口更新/u);
  assert.deepEqual(await store.load(first.id), b); assert.equal(b.saveReceipt.id, 'window-B');
});

test('native remove and restore invalidate old save receipts and cannot resurrect an old save snapshot', async () => {
  const { store } = await storeFixture(), first = await store.create(), request = { ...first, draft: '完整保留的正文' }, requestId = 'before-trash';
  const saved = await store.save(request, first.version, { requestId }), removed = await store.remove(first.id, saved.version);
  assert.equal(removed.saveReceipt, undefined); await assert.rejects(store.save(request, first.version, { requestId }), /已删除/u);
  const restored = await store.restore(first.id, removed.version); assert.equal(restored.saveReceipt, undefined);
  await assert.rejects(store.save(request, first.version, { requestId }), /另一个窗口更新/u);
  assert.equal((await store.load(first.id)).draft, request.draft); assert.equal((await store.load(first.id)).version, restored.version);
});

test('native purge moves only unshared draft attachments and protects active, historical and remaining-trash references', async () => {
  const { root, store } = await storeFixture(), files = new FileStore(root), paths = [];
  for (const title of ['private', 'active-shared', 'historical-shared', 'trash-shared']) { const path = join(root, `${title}.md`); await writeFile(path, `fixture:${title}`, { flag: 'wx' }); paths.push(path); }
  const [privateAsset, activeShared, historicalShared, trashShared] = await files.importPaths(paths);
  let selected = await store.create(), active = await store.create(), historical = await store.create(), remainingTrash = await store.create();
  selected = await store.save({ ...selected, draftAttachments: [privateAsset, activeShared, historicalShared, trashShared] }, selected.version);
  selected = await store.remove(selected.id, selected.version);
  active = await store.save({ ...active, draftAttachments: [activeShared] }, active.version);
  historical = await store.save({ ...historical, draftAttachments: [historicalShared] }, historical.version);
  historical = await store.save({ ...historical, draftAttachments: [] }, historical.version);
  remainingTrash = await store.save({ ...remainingTrash, draftAttachments: [trashShared] }, remainingTrash.version);
  remainingTrash = await store.remove(remainingTrash.id, remainingTrash.version);
  const result = await store.purge([{ id: selected.id, version: selected.version }]); assert.equal(result.sessionsMoved, 1); assert.equal(result.assetsMoved, 1);
  assert.equal(await store.load(selected.id), null);
  for (const extension of ['.bin', '.json']) await assert.rejects(stat(join(root, 'imports', privateAsset.id + extension)), { code: 'ENOENT' });
  for (const asset of [activeShared, historicalShared, trashShared]) { assert((await stat(join(root, 'imports', asset.id + '.bin'))).isFile()); assert((await stat(join(root, 'imports', asset.id + '.json'))).isFile()); }
  assert.equal((await store.load(active.id)).draftAttachments[0].id, activeShared.id); assert.equal((await store.load(remainingTrash.id)).draftAttachments[0].id, trashShared.id);
  for (let index = 0; index < paths.length; index++) assert.equal(await readFile(paths[index], 'utf8'), `fixture:${['private', 'active-shared', 'historical-shared', 'trash-shared'][index]}`);
});

const source = await readFile(new URL('../src/bridge.ts', import.meta.url), 'utf8');
const syntax = ts.createSourceFile('bridge.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
const functions = syntax.statements.filter(node => ts.isFunctionDeclaration(node) && ['request', 'browserRequest'].includes(node.name?.text)).map(node => node.getText(syntax)).join('\n');
assert.equal(syntax.statements.filter(node => ts.isFunctionDeclaration(node) && ['request', 'browserRequest'].includes(node.name?.text)).length, 2);
const compiled = ts.transpileModule(functions, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const prefix = 'save-receipt-browser:';
class MemoryStorage {
  getItem(key) { return this[key] ?? null; }
  setItem(key, value) { this[key] = String(value); }
  removeItem(key) { delete this[key]; }
  state(id) { return JSON.parse(this.getItem(prefix + id) ?? 'null'); }
}
class QueuedLocks {
  previous = Promise.resolve(); calls = [];
  request(name, fn) { this.calls.push(name); const pending = this.previous.catch(() => {}).then(fn); this.previous = pending; return pending; }
}
function browser(storage = new MemoryStorage(), locks = new QueuedLocks()) {
  const cleanup = [], context = { exports: {}, native: false, prefix, localStorage: storage, navigator: locks ? { locks } : {}, crypto: { randomUUID }, console: { warn() {} },
    assertSaveRequest, committedReplay, committedState, workspaceAssetIds, removeBrowserAssets: async ids => cleanup.push(Array.from(ids)) };
  vm.runInNewContext(compiled, context);
  return { storage, locks, cleanup, request: context.exports.request };
}

test('the actual browser request replays a committed save with a lost acknowledgement across recreated tab contexts', async () => {
  const h = browser(), first = await h.request('workspace.create'), state = { ...first, draft: '浏览器已保存', draftAttachments: [{ id: 'draft', name: '资料.pdf' }] }, payload = { state, expectedVersion: first.version, requestId: 'browser-lost-ack' };
  await assert.rejects((async () => { await h.request('workspace.save', payload); throw new Error('模拟ACK丢失'); })(), /ACK/u);
  const committed = h.storage.state(first.id), replay = await h.request('workspace.save', payload); assert.deepEqual(copy(replay), committed);
  const restarted = browser(h.storage, h.locks), reopenedReplay = await restarted.request('workspace.save', copy(payload)); assert.deepEqual(copy(reopenedReplay), committed);
  assert.equal(reopenedReplay.version, first.version + 1); assert.equal(reopenedReplay.updatedAt, committed.updatedAt);
  assert(h.locks.calls.every(name => name === 'suo-preview-workspaces'));
});

test('the actual browser request rejects changed content for the same id and preserves a different tab writer', async () => {
  const h = browser(), first = await h.request('workspace.create'), state = { ...first, draft: 'A' }, payload = { state, expectedVersion: first.version, requestId: 'browser-A' };
  const committed = await h.request('workspace.save', payload);
  await assert.rejects(h.request('workspace.save', { ...payload, state: { ...state, draft: '伪装重发' } }), /同一个保存请求包含不同内容/u);
  await assert.rejects(h.request('workspace.save', { ...payload, expectedVersion: committed.version }), /同一个保存请求包含不同内容/u);
  const other = browser(h.storage, h.locks), newer = await other.request('workspace.save', { state: { ...committed, draft: 'B' }, expectedVersion: committed.version, requestId: 'browser-B' });
  await assert.rejects(h.request('workspace.save', payload), /另一个窗口更新/u); assert.deepEqual(h.storage.state(first.id), copy(newer));
});

test('the actual browser remove and restore discard receipts and reject the old request snapshot', async () => {
  const h = browser(), first = await h.request('workspace.create'), payload = { state: { ...first, draft: '保留草稿' }, expectedVersion: first.version, requestId: 'browser-before-trash' };
  const saved = await h.request('workspace.save', payload), removed = await h.request('workspace.remove', { id: first.id, expectedVersion: saved.version });
  assert.equal(removed.saveReceipt, undefined); await assert.rejects(h.request('workspace.save', payload), /已删除/u);
  const restored = await h.request('workspace.restore', { id: first.id, expectedVersion: removed.version }); assert.equal(restored.saveReceipt, undefined);
  await assert.rejects(h.request('workspace.save', payload), /另一个窗口更新/u); assert.equal(h.storage.state(first.id).draft, '保留草稿');
});

test('the actual browser purge counts staged attachments and preserves references from active and remaining-trash drafts', async () => {
  const h = browser(), create = () => h.request('workspace.create'); let selected = await create(), active = await create(), remainingTrash = await create();
  const assets = ['private-draft', 'active-draft', 'trash-draft'].map(id => ({ id, name: `${id}.md` }));
  selected = await h.request('workspace.save', { state: { ...selected, draftAttachments: assets }, expectedVersion: selected.version }); selected = await h.request('workspace.remove', { id: selected.id, expectedVersion: selected.version });
  active = await h.request('workspace.save', { state: { ...active, draftAttachments: [assets[1]] }, expectedVersion: active.version });
  remainingTrash = await h.request('workspace.save', { state: { ...remainingTrash, draftAttachments: [assets[2]] }, expectedVersion: remainingTrash.version }); remainingTrash = await h.request('workspace.remove', { id: remainingTrash.id, expectedVersion: remainingTrash.version });
  const result = await h.request('workspace.purge', { items: [{ id: selected.id, version: selected.version }] }); assert.equal(result.sessionsMoved, 1); assert.equal(result.assetsMoved, 1); assert.deepEqual(h.cleanup, [['private-draft']]);
  assert.equal(h.storage.state(selected.id), null); assert.equal(h.storage.state(active.id).draftAttachments[0].id, 'active-draft'); assert.equal(h.storage.state(remainingTrash.id).draftAttachments[0].id, 'trash-draft');
});

test('save receipt validation rejects malformed request identities and fractional or negative versions before writing', async () => {
  const h = browser(), first = await h.request('workspace.create');
  for (const requestId of ['', '../save', 'x'.repeat(101), 42]) await assert.rejects(h.request('workspace.save', { state: first, expectedVersion: first.version, requestId }), /无效的保存请求/u);
  for (const expectedVersion of [-1, 1.5, NaN, '1']) await assert.rejects(h.request('workspace.save', { state: first, expectedVersion, requestId: 'valid-id' }), /无效的保存版本/u);
  assert.equal(h.storage.state(first.id).version, first.version);
});
