import { mkdir, readFile, readdir, open, link, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { lockedSerial } from './queue.mjs';
import { moveToTrash, retainVersions } from './trash.mjs';
import { randomUUID } from 'node:crypto';
import { assertSaveRequest, committedReplay, committedState, workspaceAssetIds } from './saveReceipt.mjs';

export const MAX_STATE_BYTES = 8 * 1024 * 1024;
const safeId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id);
export function assertId(id) {
  if (!safeId(id)) throw new Error('无效的数据标识。');
  return id;
}

// Immutable revisions avoid replacing a saved conversation on a partial write.
export class WorkspaceStore {
  constructor(root, { trashRoot } = {}) { this.root = root; this.queues = new Map(); this.trashRoot = trashRoot; }
  folder(id) { return join(this.root, 'workspaces', assertId(id), 'revisions'); }
  async load(id) {
    const folder = this.folder(id);
    const files = (await readdir(folder).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    })).filter(file => /^\d{10}\.json$/.test(file)).sort().reverse();
    for (const file of files) {
      try {
        const text = await readFile(join(folder, file), 'utf8');
        if (Buffer.byteLength(text) > MAX_STATE_BYTES) continue;
        const state = JSON.parse(text);
        if (state.id === id && state.version === Number(file.slice(0, 10))) return state;
      } catch { /* Fall back to the last complete revision. */ }
    }
    return null;
  }
  async list(trashed = false) {
    const names = await readdir(join(this.root, 'workspaces')).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const states = await Promise.all(names.filter(safeId).map(id => this.load(id)));
    return states.filter(state => state && !!state.deletedAt === trashed).map(({ id, title, updatedAt, version, pinned, deletedAt }) => ({ id, title, updatedAt, version, pinned, deletedAt }))
      .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  }
  async create() {
    const state = {
      id: randomUUID(), title: '新会话', version: 0, updatedAt: new Date().toISOString(),
      nodes: [], edges: [], messages: [], draft: '', panels: {}, viewport: { x: 0, y: 0, zoom: 1 },
    };
    return this.save(state, 0);
  }
  async remove(id, expectedVersion) {
    const state = await this.load(id);
    if (!state || state.deletedAt) throw new Error('会话不存在或已删除。');
    return this.save({ ...state, deletedAt: new Date().toISOString() }, expectedVersion, { lifecycle: true });
  }
  async restore(id, expectedVersion) {
    const state = await this.load(id);
    if (!state?.deletedAt) throw new Error('会话不在回收站中。');
    return this.save({ ...state, deletedAt: undefined }, expectedVersion, { lifecycle: true });
  }
  async purge(items) {
    if (!Array.isArray(items) || !items.length || items.length > 2000 || new Set(items.map(item => item.id)).size !== items.length) throw new Error('请先选择要清空的回收站会话。');
    return lockedSerial(join(this.root, 'workspaces'), async () => {
      const removed = [], candidates = new Set();
      for (const item of items) {
        const state = await this.load(assertId(item.id));
        if (!state?.deletedAt || state.version !== item.version) throw new Error('回收站内容已变化，请重新查看并确认。');
        removed.push(state);
      }
      const collect = state => { for (const id of workspaceAssetIds(state)) if (/^[a-f0-9-]{36}$/u.test(id)) candidates.add(id); };
      for (const state of removed) {
        const names = (await readdir(this.folder(state.id))).filter(name => /^\d{10}\.json$/u.test(name));
        for (const name of names) { try { collect(JSON.parse(await readFile(join(this.folder(state.id), name), 'utf8'))); } catch { /* Preserve unknown attachments. */ } }
      }
      const destinations = [];
      for (const state of removed) destinations.push(await moveToTrash(join(this.root, 'workspaces', state.id), this.trashRoot));
      const shared = new Set(); let safe = true;
      for (const id of (await readdir(join(this.root, 'workspaces'))).filter(safeId)) {
        const item = { id };
        for (const name of (await readdir(this.folder(item.id))).filter(name => /^\d{10}\.json$/u.test(name))) {
          try { const value = JSON.parse(await readFile(join(this.folder(item.id), name), 'utf8')); for (const id of workspaceAssetIds(value)) shared.add(id); }
          catch { safe = false; }
        }
      }
      let assetsMoved = 0;
      if (safe) for (const id of candidates) if (!shared.has(id)) {
        let moved = false;
        for (const extension of ['.bin', '.json']) {
          try { destinations.push(await moveToTrash(join(this.root, 'imports', id + extension), this.trashRoot)); moved = true; }
          catch (error) { if (error.code !== 'ENOENT') safe = false; }
        }
        if (moved) assetsMoved++;
      }
      return { sessionsMoved: removed.length, assetsMoved, ...(safe ? {} : { warning: '部分附件暂时保留，避免移走其他会话的资料。' }) };
    });
  }
  async save(state, expectedVersion, { lifecycle = false, requestId } = {}) {
    assertId(state?.id);
    assertSaveRequest(requestId, expectedVersion);
    const pending = lockedSerial(join(this.root, 'workspaces'), async () => {
      const current = await this.load(state.id);
      if (!lifecycle && (current?.deletedAt || state.deletedAt !== current?.deletedAt)) throw new Error('会话已删除，请从回收站恢复后再编辑。');
      if (committedReplay(current, state, expectedVersion, requestId)) return current;
      if (typeof state.title !== 'string' || state.title.trim().length === 0 || state.title.length > 120) throw new Error('会话名称应为 1 到 120 个字符。');
      if ((current?.version ?? 0) !== expectedVersion) throw new Error('会话已被另一个窗口更新，请重新打开后再保存。');
      if (!Array.isArray(state.nodes) || !Array.isArray(state.edges) || !Array.isArray(state.messages)) throw new Error('会话格式无效。');
      if (state.nodes.length > 2000 || state.edges.length > 4000 || state.messages.length > 5000) throw new Error('此会话超过开发版容量，请新建会话。');
      const folder = this.folder(state.id);
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const revisions = (await readdir(folder)).filter(file => /^\d{10}\.json$/.test(file));
      const highest = Math.max(expectedVersion, ...revisions.map(file => Number(file.slice(0, 10))));
      if (((await this.load(state.id))?.version ?? 0) !== expectedVersion) throw new Error('会话已被另一个窗口更新，请重新打开后再保存。');
      const next = committedState(state, highest + 1, requestId, expectedVersion);
      const text = JSON.stringify(next);
      if (Buffer.byteLength(text) > MAX_STATE_BYTES) throw new Error('此会话超过 8 MB，请缩短卡片正文。');
      const scratch = join(folder, `.pending-${randomUUID()}`);
      const handle = await open(scratch, 'wx', 0o600);
      try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
      try {
        // The final path becomes visible only after a complete, synced write.
        // link() fails rather than replacing a competing revision.
        await link(scratch, join(folder, `${String(next.version).padStart(10, '0')}.json`));
      } finally { await unlink(scratch); }
      try { await retainVersions(folder, /^\d{10}\.json$/u, 30, `${String(next.version).padStart(10, '0')}.json`, (value, name) => value.id === state.id && value.version === Number(name.slice(0, 10)), this.trashRoot); } catch { console.warn('Suo: 会话已保存，旧版本暂未整理。'); }
      return next;
    });
    this.queues.set(state.id, pending);
    try { return await pending; }
    finally { if (this.queues.get(state.id) === pending) this.queues.delete(state.id); }
  }
}
