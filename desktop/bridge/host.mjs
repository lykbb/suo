import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkspaceStore } from './store.mjs';
import { FileStore } from './files.mjs';
import { JsonLines } from './rpc.mjs';
import { Connections } from './connections.mjs';
import { Chat } from './chat.mjs';
import { SkillLibrary, TemplateLibrary } from './skills.mjs';

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataRoot = process.env.SUO_DESKTOP_DATA ?? resolve(desktopRoot, 'data');
const engineRoot = process.env.SUO_DESKTOP_ENGINE ?? resolve(desktopRoot, '..');
const skillsRoot = process.env.SUO_DESKTOP_SKILLS ?? resolve(engineRoot, 'skills');
const userSkillsRoot = process.env.SUO_DESKTOP_USER_SKILLS ?? (resolve(skillsRoot) === resolve(engineRoot, 'skills') ? skillsRoot : resolve(dataRoot, 'skills'));
const skills = new SkillLibrary({ builtinRoot: skillsRoot, writableRoot: userSkillsRoot });
const templates = new TemplateLibrary(resolve(dataRoot, 'templates'));
const store = new WorkspaceStore(dataRoot), files = new FileStore(dataRoot);
const write = record => process.stdout.write(`${JSON.stringify(record)}\n`);
const emit = (event, data) => write({ event, data });
const connections = new Connections({ root: engineRoot, dataRoot });
const chat = new Chat({ root: engineRoot, connections, emit, skillsRoot: skills });
const operations = new Set();

async function request(method, payload = {}) {
  switch (method) {
    case 'workspace.list': return store.list();
    case 'workspace.create': return store.create();
    case 'workspace.load': { const state = await store.load(payload.id); return state?.deletedAt ? null : state; }
    case 'workspace.trash': return store.list(true);
    case 'workspace.remove': return store.remove(payload.id, payload.expectedVersion);
    case 'workspace.purge': return store.purge(payload.items);
    case 'workspace.restore': return store.restore(payload.id, payload.expectedVersion);
    case 'workspace.save': return store.save(payload.state, payload.expectedVersion, { requestId: payload.requestId });
    case 'asset.get': return files.get(payload.id, { metadataOnly: true });
    case 'native.import': return files.importPaths(payload.paths ?? []);
    case 'models.list': return connections.list();
    case 'models.configure': if (chat.active) throw new Error('请先停止当前回复。'); return connections.configure(payload);
    case 'models.check': return chat.check(payload);
    case 'models.discover': return connections.discover(payload);
    case 'native.model-config': if (chat.active) throw new Error('请先停止当前回复。'); return connections.import(payload.path);
    case 'prompt.send': return chat.start(payload);
    case 'prompt.abort': return chat.abort(payload.runId);
    case 'ui.reply': return chat.reply(payload);
    case 'skills.list': return skills.list();
    case 'skills.get': return skills.get(payload.name);
    case 'skills.parse': return skills.parse(payload);
    case 'skills.save': return skills.save(payload);
    case 'templates.list': return templates.list();
    case 'templates.get': return templates.get(payload.id);
    case 'templates.save': return templates.save(payload);
    default: throw new Error('未知的桌面操作。');
  }
}
const parser = new JsonLines(record => {
  if (typeof record.id !== 'string' || typeof record.method !== 'string') return;
  if (shuttingDown) { write({ id: record.id, error: '桥接正在关闭。' }); return; }
  const operation = Promise.resolve().then(() => request(record.method, record.payload))
    .then(result => write({ id: record.id, result }))
    .catch(error => write({ id: record.id, error: error.message }));
  operations.add(operation);
  operation.finally(() => operations.delete(operation));
});
process.stdin.setEncoding('utf8');
process.stdin.on('data', data => { try { parser.push(data); } catch { write({ event: 'bridge-error', data: { message: '桌面消息格式无效。' } }); } });
let shuttingDown = false;
async function shutdown() { if (shuttingDown) return; shuttingDown = true; await Promise.allSettled([chat.close(), ...operations]); process.exit(0); }
process.stdin.on('end', shutdown); process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
