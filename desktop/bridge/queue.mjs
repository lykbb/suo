import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import { uptime } from 'node:os';
import { setTimeout as pause } from 'node:timers/promises';
import { resolve, join } from 'node:path';
const queues = new Map();
export async function serial(key, operation) {
  const id = resolve(key), prior = queues.get(id) ?? Promise.resolve();
  const pending = prior.catch(() => {}).then(operation);
  queues.set(id, pending);
  try { return await pending; }
  finally { if (queues.get(id) === pending) queues.delete(id); }
}

const bootTime = () => Date.now() - uptime() * 1000;
const missing = error => { if (error.code !== 'ENOENT') throw error; };

// A lock is abandoned when its owner has exited, when it was written before the last restart (the
// process number may now belong to another program), or when its owner died before writing it.
async function abandoned(lock) {
  let text, info;
  try { [text, info] = await Promise.all([readFile(lock, 'utf8'), stat(lock)]); }
  catch (error) { missing(error); return false; }
  const [pid, boot] = text.split(' ').map(Number);
  if (!Number.isSafeInteger(pid) || pid <= 0) return Date.now() - info.mtimeMs > 5000;
  if (Number.isFinite(boot) && Math.abs(boot - bootTime()) > 120000) return true;
  try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; }
}

// One process at a time removes an abandoned lock, re-checking under a guard file of its own.
async function reclaim(lock) {
  const guard = lock + '-reclaim';
  let handle;
  try { handle = await open(guard, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    try { if (Date.now() - (await stat(guard)).mtimeMs > 5000) await unlink(guard); } catch (failure) { missing(failure); }
    return;
  }
  try { if (await abandoned(lock)) await unlink(lock).catch(missing); }
  finally { await handle.close(); await unlink(guard).catch(missing); }
}

// A process-wide queue is paired with an exclusive file lock for multiple desktop hosts.
export async function lockedSerial(key, operation) {
  return serial(key, async () => {
    await mkdir(key, { recursive: true, mode: 0o700 });
    const lock = join(key, '.write-lock'), deadline = Date.now() + 12000;
    let handle;
    while (!handle) {
      try { handle = await open(lock, 'wx', 0o600); await handle.writeFile(`${process.pid} ${Math.round(bootTime())}`); await handle.sync(); }
      catch (error) {
        if (handle) { await handle.close(); await unlink(lock); throw error; }
        if (error.code !== 'EEXIST') throw error;
        if (await abandoned(lock)) await reclaim(lock);
        if (Date.now() > deadline) throw new Error('数据正在被另一个窗口整理，请稍后重试。');
        await pause(40);
      }
    }
    try { return await operation(); }
    finally { await handle.close(); await unlink(lock); }
  });
}
