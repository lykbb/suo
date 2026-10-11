import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDirectory } from './helpers/test-data.mjs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

test('desktop JSON bridge lists, removes, rejects stale saves and restores a session with its contents', async () => {
  const data = await createTestDirectory('session-host-');
  const child = spawn(process.execPath, [fileURLToPath(new URL('../bridge/host.mjs', import.meta.url))], {
    env: { ...process.env, SUO_DESKTOP_DATA: data, SUO_DESKTOP_ENGINE: join(data, 'unused-engine') },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  let sequence = 0;
  let diagnostic = '';
  child.stderr.on('data', value => { diagnostic += value.toString(); });
  createInterface({ input: child.stdout }).on('line', line => {
    const reply = JSON.parse(line), item = pending.get(reply.id);
    if (!item) return;
    pending.delete(reply.id); clearTimeout(item.timer);
    reply.error ? item.reject(new Error(reply.error)) : item.resolve(reply.result);
  });
  const request = (method, payload = {}) => new Promise((resolve, reject) => {
    const id = String(++sequence);
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`桥接超时：${diagnostic}`)); }, 5000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, payload }) + '\n');
  });
  try {
    const first = await request('workspace.create');
    const saved = await request('workspace.save', { state: { ...first, title: '桥接验收', draft: '保留正文', pinned: true }, expectedVersion: first.version });
    const removed = await request('workspace.remove', { id: saved.id, expectedVersion: saved.version });
    assert.deepEqual(await request('workspace.list'), []);
    assert.equal(await request('workspace.load', { id: saved.id }), null);
    const trash = await request('workspace.trash');
    assert.equal(trash[0].id, saved.id);
    await assert.rejects(request('workspace.save', { state: saved, expectedVersion: saved.version }));
    const restored = await request('workspace.restore', { id: saved.id, expectedVersion: removed.version });
    assert.equal(restored.draft, '保留正文'); assert.equal(restored.pinned, true);
    assert.equal((await request('workspace.list'))[0].id, saved.id);
    assert.deepEqual(await request('workspace.trash'), []);
  } finally {
    child.stdin.end();
    await new Promise(resolve => child.once('exit', resolve));
  }
});
