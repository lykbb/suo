import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { assertSaveRequest, committedReplay, committedState, workspaceAssetIds } from '../bridge/saveReceipt.mjs';

const prefix = 'suo-desktop-preview:';
const source = await readFile(new URL('../src/bridge.ts', import.meta.url), 'utf8');
const start = source.indexOf('export async function request<');
const end = source.indexOf('\nfunction emit(', start);
assert(start >= 0 && end > start, 'Cannot locate the real browser request functions.');
const compiled = ts.transpileModule(source.slice(start, end).replace(/^export /u, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  reportDiagnostics: true,
});
const errors = (compiled.diagnostics ?? []).filter(item => item.category === ts.DiagnosticCategory.Error);
assert.equal(errors.length, 0, errors.map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n')).join('\n'));

class MemoryStorage {
  getItem(key) { return this[key] ?? null; }
  setItem(key, value) { this[key] = String(value); }
  removeItem(key) { delete this[key]; }
  put(state) { this.setItem(prefix + state.id, JSON.stringify(state)); }
  read(id) { return JSON.parse(this.getItem(prefix + id) ?? 'null'); }
}

// Each simulated tab gets its own bridge context but shares this lock manager.
class QueuedWebLocks {
  queues = new Map();
  requested = [];
  entered = [];
  active = 0;
  maxActive = 0;
  request(name, callback) {
    this.requested.push(name);
    const previous = this.queues.get(name) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
      this.entered.push(name);
      this.active++;
      this.maxActive = Math.max(this.maxActive, this.active);
      try { return await callback({ name, mode: 'exclusive' }); }
      finally { this.active--; }
    });
    this.queues.set(name, pending);
    return pending.finally(() => {
      if (this.queues.get(name) === pending) this.queues.delete(name);
    });
  }
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function cleanupGate() {
  const started = deferred(), release = deferred();
  return { started: started.promise, release: release.resolve, async run() { started.resolve(); await release.promise; } };
}

function bridge(storage, locks, cleanup = async () => {}) {
  const cleanupCalls = [];
  const request = runInNewContext(compiled.outputText + '\nrequest;', {
    native: false, prefix, localStorage: storage,
    navigator: locks ? { locks } : {},
    crypto: { randomUUID }, console,
    assertSaveRequest, committedReplay, committedState, workspaceAssetIds,
    async removeBrowserAssets(ids) { cleanupCalls.push(Array.from(ids)); await cleanup(ids); },
    async loadBrowserAsset() { throw new Error('Unexpected asset read.'); },
  }, { filename: 'src/bridge.ts' });
  return { request, cleanupCalls };
}

function workspace(id, { deleted = false, version = 1, assets = [] } = {}) {
  return {
    id, title: id, version, updatedAt: '2026-10-10T12:00:00.000Z',
    nodes: assets.map((assetId, index) => ({ id: `${id}-${index}`, data: { asset: { id: assetId } } })),
    edges: [], messages: [], draft: '', panels: {}, viewport: { x: 0, y: 0, zoom: 1 },
    ...(deleted ? { deletedAt: '2026-10-10T12:00:00.000Z' } : {}),
  };
}

const tick = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));

test('another tab cannot restore a purged session while attachment cleanup holds the lock', { timeout: 5000 }, async () => {
  const storage = new MemoryStorage(), locks = new QueuedWebLocks(), gate = cleanupGate();
  storage.put(workspace('trash', { deleted: true, assets: ['private-asset'] }));
  const first = bridge(storage, locks, () => gate.run()), second = bridge(storage, locks);
  const purging = first.request('workspace.purge', { items: [{ id: 'trash', version: 1 }] });
  await gate.started;
  let restoreSettled = false;
  const restoring = second.request('workspace.restore', { id: 'trash', expectedVersion: 1 }).then(
    value => { restoreSettled = true; return { value }; },
    error => { restoreSettled = true; return { error }; },
  );
  try {
    await tick();
    assert.equal(restoreSettled, false);
    assert.equal(locks.entered.length, 1);
    assert.equal(storage.read('trash'), null, 'Remove the session before awaiting attachment cleanup.');
    assert.deepEqual(locks.requested, ['suo-preview-workspaces', 'suo-preview-workspaces']);
  } finally { gate.release(); }
  assert.deepEqual(plain(await purging), { sessionsMoved: 1, assetsMoved: 1 });
  const result = await restoring;
  assert.match(String(result.error?.message), /会话不存在或状态已变化/u);
  assert.equal(storage.read('trash'), null);
  assert.deepEqual(first.cleanupCalls, [['private-asset']]);
  assert.equal(locks.maxActive, 1);
});

test('another tab saves a remaining session only after purge releases the workspace lock', { timeout: 5000 }, async () => {
  const storage = new MemoryStorage(), locks = new QueuedWebLocks(), gate = cleanupGate();
  const active = workspace('active', { version: 2 });
  storage.put(active);
  storage.put(workspace('trash', { deleted: true, assets: ['private-asset'] }));
  const first = bridge(storage, locks, () => gate.run()), second = bridge(storage, locks);
  const purging = first.request('workspace.purge', { items: [{ id: 'trash', version: 1 }] });
  await gate.started;
  let saveSettled = false;
  const saving = second.request('workspace.save', {
    state: { ...active, title: 'Saved by the other tab' }, expectedVersion: 2,
  }).then(value => { saveSettled = true; return { value }; }, error => { saveSettled = true; return { error }; });
  try {
    await tick();
    assert.equal(saveSettled, false);
    assert.equal(storage.read('active').version, 2);
    assert.equal(storage.read('active').title, 'active');
    assert.equal(locks.entered.length, 1);
  } finally { gate.release(); }
  assert.deepEqual(plain(await purging), { sessionsMoved: 1, assetsMoved: 1 });
  const result = await saving;
  assert.equal(result.error, undefined);
  assert.equal(result.value.version, 3);
  assert.equal(storage.read('active').title, 'Saved by the other tab');
  assert.equal(locks.entered.length, 2);
  assert.equal(locks.maxActive, 1);
});

test('purge preserves attachments shared with active sessions and unselected trash sessions', async () => {
  const storage = new MemoryStorage(), locks = new QueuedWebLocks();
  storage.put(workspace('trash', { deleted: true, assets: ['active-shared', 'trash-shared', 'private-asset'] }));
  const active = workspace('active', { assets: ['active-shared'] });
  const otherTrash = workspace('other-trash', { deleted: true, assets: ['trash-shared'] });
  storage.put(active); storage.put(otherTrash);
  const tab = bridge(storage, locks);
  const result = await tab.request('workspace.purge', { items: [{ id: 'trash', version: 1 }] });
  assert.deepEqual(plain(result), { sessionsMoved: 1, assetsMoved: 1 });
  assert.deepEqual(tab.cleanupCalls, [['private-asset']]);
  assert.equal(storage.read('trash'), null);
  assert.deepEqual(storage.read('active'), active);
  assert.deepEqual(storage.read('other-trash'), otherTrash);
});

test('a stale version rejects the whole purge batch before removing sessions or attachments', async () => {
  const storage = new MemoryStorage(), locks = new QueuedWebLocks();
  const first = workspace('first', { deleted: true, assets: ['first-asset'] });
  const changed = workspace('changed', { deleted: true, version: 2, assets: ['second-asset'] });
  storage.put(first); storage.put(changed);
  const tab = bridge(storage, locks);
  await assert.rejects(tab.request('workspace.purge', {
    items: [{ id: 'first', version: 1 }, { id: 'changed', version: 1 }],
  }), /回收站内容已变化/u);
  assert.deepEqual(storage.read('first'), first);
  assert.deepEqual(storage.read('changed'), changed);
  assert.deepEqual(tab.cleanupCalls, []);
  assert.equal(locks.active, 0);
});

test('duplicate session identifiers reject purge before any deletion', async () => {
  const storage = new MemoryStorage(), locks = new QueuedWebLocks();
  const state = workspace('trash', { deleted: true, assets: ['private-asset'] });
  storage.put(state);
  const tab = bridge(storage, locks);
  await assert.rejects(tab.request('workspace.purge', {
    items: [{ id: 'trash', version: 1 }, { id: 'trash', version: 1 }],
  }), /请先选择回收站会话/u);
  assert.deepEqual(storage.read('trash'), state);
  assert.deepEqual(tab.cleanupCalls, []);
});

test('without Web Locks purge removes sessions but retains attachments and returns a warning', async () => {
  const storage = new MemoryStorage();
  const active = workspace('active', { assets: ['shared-asset'] });
  storage.put(active);
  storage.put(workspace('trash', { deleted: true, assets: ['shared-asset', 'private-asset'] }));
  const tab = bridge(storage);
  const result = await tab.request('workspace.purge', { items: [{ id: 'trash', version: 1 }] });
  assert.equal(result.sessionsMoved, 1);
  assert.equal(result.assetsMoved, 0);
  assert.match(result.warning, /不能锁定多个窗口.*附件暂时保留/u);
  assert.equal(storage.read('trash'), null);
  assert.deepEqual(storage.read('active'), active);
  assert.deepEqual(tab.cleanupCalls, []);
});
