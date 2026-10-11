import { mkdir, rename, readdir, readFile, unlink } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

export async function moveToTrash(path, trashRoot = process.env.SUO_TEST_TRASH_ROOT ?? join(homedir(), '.Trash')) {
  const folder = join(trashRoot, 'Suo');
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const target = join(folder, `${basename(path)}-${randomUUID()}`);
  await rename(path, target);
  return target;
}

// Revisions never change once written, so each one is read and checked once per process: a save
// then costs one directory listing instead of re-reading every kept version.
const checked = new Map();
async function isValid(path, name, validate) {
  if (checked.has(path)) return checked.get(path);
  let valid;
  try { valid = !!validate(JSON.parse(await readFile(path, 'utf8')), name); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    if (!(error instanceof SyntaxError)) throw error;
    valid = false;
  }
  checked.set(path, valid);
  return valid;
}

// Only complete versions at or below this commit are eligible. Keep `limit` valid versions; invalid
// files newer than the oldest kept one stay for diagnosis, everything older is deleted. These are the
// App's own backups, written on every save, so they never go to the user's Trash; connection versions
// also hold API keys, which must not pile up there.
export async function retainVersions(folder, pattern, limit, ceiling, validate) {
  const names = (await readdir(folder)).filter(name => pattern.test(name) && name <= ceiling).sort().reverse();
  let valid = 0;
  for (const name of names) {
    const path = join(folder, name);
    if (valid < limit) { if (await isValid(path, name, validate)) valid++; continue; }
    try { await unlink(path); checked.delete(path); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
