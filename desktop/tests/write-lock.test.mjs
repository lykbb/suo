import test from 'node:test';
import assert from 'node:assert/strict';
import { access, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { uptime } from 'node:os';
import { lockedSerial } from '../bridge/queue.mjs';
import { createTestDirectory } from './helpers/test-data.mjs';

const gone = path => access(path).then(() => false, () => true);

test('an empty lock left by a crash right after creation is reclaimed', async () => {
  const root = await createTestDirectory('lock-empty-'), lock = join(root, '.write-lock');
  await writeFile(lock, '');
  const old = new Date(Date.now() - 10000);
  await utimes(lock, old, old);
  assert.equal(await lockedSerial(root, async () => 'saved'), 'saved');
  assert.equal(await gone(lock), true);
});

test('a lock written before the last restart is reclaimed even if its process number is in use again', async () => {
  const root = await createTestDirectory('lock-reboot-'), lock = join(root, '.write-lock');
  // This test process is alive, so only the boot time can show the lock is stale.
  const beforeRestart = Math.round(Date.now() - uptime() * 1000 - 3600000);
  await writeFile(lock, `${process.pid} ${beforeRestart}`);
  assert.equal(await lockedSerial(root, async () => 'saved'), 'saved');
  assert.equal(await gone(lock), true);
});
