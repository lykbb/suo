import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestDirectory } from './helpers/test-data.mjs';
import { WorkspaceStore, assertId } from '../bridge/store.mjs';

test('versioned save detects concurrent modification and preserves older revision', async () => {
  const dir = await createTestDirectory('store-'), store = new WorkspaceStore(dir);
  const first = await store.create();
  const second = await store.save({ ...first, title: '访谈', draft: '未发送的想法' }, first.version);
  assert.equal(second.version, 2);
  const original = JSON.parse(await readFile(join(store.folder(first.id), '0000000001.json'), 'utf8'));
  assert.equal(original.title, '新会话');
  const results = await Promise.allSettled([store.save({ ...second, title: 'A' }, 2), store.save({ ...second, title: 'B' }, 2)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.equal((await store.load(first.id)).version, 3);
});
test('corrupt latest revision falls back to the last valid state', async () => {
  const dir = await createTestDirectory('fallback-'), store = new WorkspaceStore(dir), state = await store.create();
  await writeFile(join(store.folder(state.id), '0000000002.json'), '{', { flag: 'wx' });
  assert.equal((await store.load(state.id)).version, 1);
  const recovered = await store.save({ ...state, title: '恢复后' }, 1);
  assert.equal(recovered.version, 3);
  assert.equal((await store.load(state.id)).title, '恢复后');
});
test('independent stores cannot both commit the same expected revision', async () => {
  const dir = await createTestDirectory('atomic-'), a = new WorkspaceStore(dir), b = new WorkspaceStore(dir);
  const state = await a.create();
  const replies = await Promise.allSettled([a.save({ ...state, title: 'A' }, 1), b.save({ ...state, title: 'B' }, 1)]);
  assert.equal(replies.filter(reply => reply.status === 'fulfilled').length, 1);
  assert.equal((await a.load(state.id)).version, 2);
});
test('identifiers reject traversal and state size is bounded', async () => {
  for (const id of ['../auth', '/etc/passwd', '..', 'x/y', '']) assert.throws(() => assertId(id));
  const dir = await createTestDirectory('bounds-'), store = new WorkspaceStore(dir), state = await store.create();
  await assert.rejects(store.save({ ...state, draft: 'x'.repeat(9 * 1024 * 1024) }, 1), /8 MB/);
  assert.equal((await store.load(state.id)).version, 1);
});
