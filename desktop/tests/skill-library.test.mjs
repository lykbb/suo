import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { SkillLibrary, TemplateLibrary } from '../bridge/skills.mjs';
import { createTools, listSkills, readSkill } from '../bridge/agent.mjs';
import { Chat } from '../bridge/chat.mjs';
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from '../../node_modules/@earendil-works/pi-ai/dist/providers/faux.js';
import { createTestDirectory } from './helpers/test-data.mjs';

const engine = fileURLToPath(new URL('../../', import.meta.url));
const info = (name = 'interview-coach') => ({ name, title: '访谈教练', description: '从真实经历中提取证据', body: '# 方法\n先问最近一次经历，再区分事实和假设。', expectedRevision: null });
const setup = async prefix => {
  const folder = await createTestDirectory(prefix);
  const builtinRoot = join(folder, 'builtins'), writableRoot = join(folder, 'custom');
  await mkdir(builtinRoot);
  return { folder, builtinRoot, writableRoot, library: new SkillLibrary({ builtinRoot, writableRoot }) };
};

test('import parses YAML multiline metadata and preserves text assets without executing them', async () => {
  const { library } = await setup('skill-import-');
  const parsed = library.parse({ files: [
    { path: 'SKILL.md', content: '---\nname: custom-research\ndisplay_name: "研究教练"\ndescription: >-\n  第一段说明，\n  第二段说明。\n---\n\n# 研究\n读取 references/questions.md 和 scripts/report.py。' },
    { path: 'references/questions.md', content: '请说说最近一次。' },
    { path: 'scripts/report.py', content: 'raise Exception("must not run")' },
    { path: 'assets/report.html', content: '<h1>模板</h1>' },
  ] });
  assert.equal(parsed.description, '第一段说明， 第二段说明。');
  assert.equal(parsed.title, '研究教练');
  const saved = await library.save({ ...parsed, expectedRevision: null });
  assert.deepEqual(saved.files.map(file => file.path), ['assets/report.html', 'references/questions.md', 'scripts/report.py']);
  assert.match((await library.read(parsed.name, 'scripts/report.py')).text, /must not run/);
  assert.throws(() => library.parse({ files: [{ path: 'SKILL.md', content: '---\nname: x\nname: y\ndescription: a\n---\nb' }] }), /格式无效/);
});

test('skill save, refreshed list, get and Agent use_skill share one persisted registry', async () => {
  const { library, builtinRoot, writableRoot } = await setup('skill-chain-');
  const saved = await library.save({ ...info(), files: [{ path: 'references/questions.md', content: '最近一次是什么时候？' }] });
  assert.equal(saved.skill.editable, true); assert.equal(saved.skill.source, 'custom');
  assert.equal((await readFile(join(writableRoot, info().name, 'SKILL.md'), 'utf8')).startsWith('---\nname: interview-coach\n'), true);
  const refreshed = new SkillLibrary({ builtinRoot, writableRoot });
  assert.deepEqual(await refreshed.list(), [saved.skill]);
  assert.equal((await refreshed.get(info().name)).body, info().body);
  const tool = createTools({ ui: async () => ({}), skillsRoot: refreshed }).find(tool => tool.name === 'use_skill');
  const result = await tool.execute('call', { name: saved.skill.name });
  assert.match(result.content[0].text, /先问最近一次经历/);
  assert.match(result.content[0].text, /references\/questions.md/);
  assert.match((await tool.execute('call', { name: saved.skill.name, file: 'references/questions.md' })).content[0].text, /最近一次是什么时候/);
});

test('editing requires current revision, preserves imported references and stores no growing snapshots', async () => {
  const { library, writableRoot } = await setup('skill-revision-');
  let saved = await library.save({ ...info(), files: [{ path: 'references/questions.md', content: '问题' }] });
  const original = saved.skill.revision;
  for (let index = 0; index < 8; index++) saved = await library.save({ ...info(), body: `# 修改 ${index}\n正文`, files: saved.files, expectedRevision: saved.skill.revision });
  await assert.rejects(library.save({ ...info(), expectedRevision: original }), /另一个窗口更新/);
  await assert.rejects(library.save({ ...info(), files: [], expectedRevision: saved.skill.revision }), /保留已导入/);
  assert.deepEqual((await readdir(join(writableRoot, info().name))).sort(), ['SKILL.md', 'references']);
  assert.deepEqual(await readdir(writableRoot), [info().name]);
});

test('builtins stay immutable, duplicate imported names/folders cannot silently replace them', async () => {
  const { library, builtinRoot } = await setup('skill-builtin-');
  await mkdir(join(builtinRoot, 'interview-coach'));
  const original = '---\nname: interview-coach\ndescription: 内置访谈\n---\n先准备问题。';
  await writeFile(join(builtinRoot, 'interview-coach', 'SKILL.md'), original);
  const [builtin] = await library.list();
  assert.equal(builtin.editable, false);
  await assert.rejects(library.save({ ...info(), expectedRevision: builtin.revision }), /内置技能/);
  assert.equal(await readFile(join(builtinRoot, 'interview-coach', 'SKILL.md'), 'utf8'), original);
});

test('concurrent creates and stale edits publish exactly one revision', async () => {
  const { library, builtinRoot, writableRoot } = await setup('skill-concurrent-');
  const another = new SkillLibrary({ builtinRoot, writableRoot });
  const results = await Promise.allSettled([library.save(info()), another.save(info())]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const saved = await library.get(info().name);
  const edits = await Promise.allSettled([library.save({ ...info(), body: '修改 A', expectedRevision: saved.skill.revision }), another.save({ ...info(), body: '修改 B', expectedRevision: saved.skill.revision })]);
  assert.equal(edits.filter(result => result.status === 'fulfilled').length, 1);
});

test('invalid paths, binary files, duplicate references and symbolic links are refused', async () => {
  const { library, folder, builtinRoot, writableRoot } = await setup('skill-paths-');
  for (const path of ['../escape.md', '/tmp/escape.md', 'a\\escape.md', '.hidden.md', 'SKILL.md', 'refs/a.exe']) await assert.rejects(library.save({ ...info(), files: [{ path, content: 'bad' }] }), /参考文件/);
  await assert.rejects(library.save({ ...info(), files: [{ path: 'a.md', content: '\0' }] }), /文本/);
  await assert.rejects(library.save({ ...info(), files: [{ path: 'A.md', content: 'a' }, { path: 'a.md', content: 'b' }] }), /重复/);
  const outside = join(folder, 'outside'); await mkdir(outside);
  await symlink(outside, writableRoot);
  await assert.rejects(library.save(info()), /软链接/);
  assert.deepEqual(await readdir(outside), []);
  await mkdir(join(builtinRoot, 'bad'));
  await writeFile(join(outside, 'SKILL.md'), '---\nname: outside\ndescription: 不读\n---\n隐私');
  await symlink(join(outside, 'SKILL.md'), join(builtinRoot, 'bad', 'SKILL.md'));
  assert.deepEqual(await library.list().catch(() => []), []);
});

test('body/file limits and missing revision prevent writes before validation', async () => {
  const { library, writableRoot } = await setup('skill-limits-');
  await assert.rejects(library.save({ ...info(), body: 'a'.repeat(400 * 1024 + 1) }), /400 KiB/);
  await assert.rejects(library.save({ ...info(), files: Array.from({ length: 65 }, (_, index) => ({ path: `${index}.md`, content: 'a' })) }), /64/);
  const saved = await library.save(info());
  await assert.rejects(library.save(info()), /另一个窗口更新/);
  assert.equal((await library.get(info().name)).skill.revision, saved.skill.revision);
  assert.deepEqual(await readdir(writableRoot), [info().name]);
});

test('legacy single-root read-only skill API retains its public list contract', async () => {
  const { builtinRoot } = await setup('skill-legacy-');
  await mkdir(join(builtinRoot, 'legacy'));
  await writeFile(join(builtinRoot, 'legacy', 'SKILL.md'), '---\nname: legacy\ndescription: 旧格式\n---\n正文');
  assert.deepEqual(await listSkills(builtinRoot), [{ name: 'legacy', title: 'legacy', description: '旧格式', folder: 'legacy' }]);
  await assert.rejects(readSkill(builtinRoot, 'legacy', '../secret.md'), /技能目录/);
});

test('custom templates survive reload and use revision conflict protection with one record', async () => {
  const root = await createTestDirectory('template-chain-');
  const library = new TemplateLibrary(join(root, 'templates'));
  const id = randomUUID(), fields = { id, title: '机会评估', description: '记录证据和假设', body: '# 机会\n## 证据\n## 假设', expectedRevision: null };
  let saved = await library.save(fields); const original = saved.template.revision;
  for (let index = 0; index < 5; index++) saved = await library.save({ ...fields, body: `# 版本 ${index}`, expectedRevision: saved.template.revision });
  const refreshed = new TemplateLibrary(join(root, 'templates'));
  assert.deepEqual(await refreshed.list(), [saved.template]); assert.equal((await refreshed.get(id)).body, '# 版本 4');
  await assert.rejects(library.save({ ...fields, expectedRevision: original }), /另一个窗口更新/);
  assert.deepEqual(await readdir(join(root, 'templates')), [`${id}.json`]);
});

test('fresh Agent run sees a newly saved skill and loads its actual instructions by canonical name', async () => {
  const { library } = await setup('skill-agent-');
  const config = { providers: { scripted: { api: 'openai-completions', baseUrl: 'https://scripted.invalid/v1', apiKey: 'scripted-key', models: [{ id: 'scripted', name: 'scripted', contextWindow: 32768, maxTokens: 1024 }] } } };
  const core = createFauxCore({ provider: 'scripted', models: [{ id: 'scripted' }] }), requests = [];
  core.setResponses([
    context => { requests.push(context); return fauxAssistantMessage(fauxToolCall('use_skill', { name: info().name }, { id: 'call-1' }), { stopReason: 'toolUse' }); },
    context => { requests.push(context); return fauxAssistantMessage('已按访谈方法继续。'); },
  ]);
  const chat = new Chat({ root: engine, connections: { load: async () => config }, skillsRoot: library, emit: () => {}, runtimeFactory: async () => ({ getModel: (provider, id) => ({ ...config.providers.scripted.models[0], id, provider, api: 'openai-completions', input: ['text'] }), streamSimple: core.streamSimple }) });
  await library.save(info());
  chat.start({ workspaceId: randomUUID(), message: '使用 interview-coach', history: [], selected: [] });
  await chat.active.done;
  assert.match(requests[0].messages[0].content, /interview-coach：从真实经历中提取证据/);
  assert.match(requests[1].messages.find(message => message.role === 'toolResult').content[0].text, /先问最近一次经历/);
});

function hostClient(dataRoot, builtinRoot, writableRoot) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../bridge/host.mjs', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, SUO_DESKTOP_DATA: dataRoot, SUO_DESKTOP_SKILLS: builtinRoot, SUO_DESKTOP_USER_SKILLS: writableRoot, SUO_DESKTOP_ENGINE: engine, PI_OFFLINE: '1' } });
  const pending = new Map(); let sequence = 0, diagnostic = '';
  child.stderr.on('data', value => { diagnostic += value.toString(); });
  createInterface({ input: child.stdout }).on('line', line => { const reply = JSON.parse(line), job = pending.get(reply.id); if (!job) return; pending.delete(reply.id); clearTimeout(job.timer); reply.error ? job.reject(new Error(reply.error)) : job.resolve(reply.result); });
  return { request(method, payload = {}) { return new Promise((resolve, reject) => { const id = String(++sequence), timer = setTimeout(() => { pending.delete(id); reject(new Error(`桥接超时 ${diagnostic}`)); }, 5000); pending.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ id, method, payload }) + '\n'); }); }, async close() { child.stdin.end(); await new Promise(resolve => child.once('exit', resolve)); } };
}

test('actual host RPC routes parse/save/list/get for skills and templates and survives restart', async () => {
  const { folder, builtinRoot, writableRoot } = await setup('skill-host-');
  const dataRoot = join(folder, 'data');
  let host = hostClient(dataRoot, builtinRoot, writableRoot);
  const fields = info(); let skill, template;
  try {
    const parsed = await host.request('skills.parse', { files: [{ path: 'SKILL.md', content: `---\nname: ${fields.name}\ndisplay_name: ${fields.title}\ndescription: ${fields.description}\n---\n${fields.body}` }] });
    skill = await host.request('skills.save', { ...parsed, expectedRevision: null });
    assert.deepEqual(await host.request('skills.list'), [skill.skill]);
    assert.equal((await host.request('skills.get', { name: fields.name })).body, fields.body);
    template = await host.request('templates.save', { title: '访谈记录', description: '按事实整理', body: '# 最近一次' });
    assert.deepEqual(await host.request('templates.list'), [template.template]);
    assert.equal((await host.request('templates.get', { id: template.template.id })).body, '# 最近一次');
    await assert.rejects(host.request('skills.save', fields), /另一个窗口更新/);
    await assert.rejects(host.request('skills.get', { name: '../outside' }), /没有名为/);
  } finally { await host.close(); }
  host = hostClient(dataRoot, builtinRoot, writableRoot);
  try { assert.deepEqual(await host.request('skills.list'), [skill.skill]); assert.deepEqual(await host.request('templates.list'), [template.template]); }
  finally { await host.close(); }
});

test('actual local dev HTTP authorizes every skill/template route and persists into isolated paths', async () => {
  const { folder, builtinRoot, writableRoot } = await setup('skill-http-');
  const dataRoot = join(folder, 'data'), site = join(folder, 'site');
  await mkdir(site); await writeFile(join(site, 'index.html'), '<!doctype html><html><head></head><body>Skill test</body></html>');
  const names = ['SUO_DESKTOP_DATA', 'SUO_DESKTOP_ENGINE', 'SUO_DESKTOP_SKILLS', 'SUO_DESKTOP_USER_SKILLS'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  Object.assign(process.env, { SUO_DESKTOP_DATA: dataRoot, SUO_DESKTOP_ENGINE: engine, SUO_DESKTOP_SKILLS: builtinRoot, SUO_DESKTOP_USER_SKILLS: writableRoot });
  const { createServer } = await import('vite'), { devApi } = await import('../bridge/dev-api.mjs');
  let server;
  try {
    server = await createServer({ configFile: false, root: site, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] }, server: { host: '127.0.0.1', port: 0 }, plugins: [devApi()] });
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    const html = await (await fetch(origin)).text();
    const token = html.match(/name="suo-local-api" content="([a-f0-9]+)"/u)?.[1]; assert.ok(token);
    const request = async (method, payload = {}) => {
      const response = await fetch(`${origin}/__suo/request`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Suo-Token': token }, body: JSON.stringify({ method, payload }) });
      assert.equal(response.status, 200, `${method}: ${await response.clone().text()}`);
      const reply = await response.json(); assert.equal(reply.error, undefined); return reply.result;
    };
    const fields = info('http-research');
    const parsed = await request('skills.parse', { files: [{ path: 'SKILL.md', content: `---\nname: ${fields.name}\ndisplay_name: ${fields.title}\ndescription: ${fields.description}\n---\n${fields.body}` }, { path: 'references/readme.md', content: 'HTTP 参考正文' }] });
    const saved = await request('skills.save', { ...parsed, expectedRevision: null });
    assert.deepEqual(await request('skills.list'), [saved.skill]);
    assert.deepEqual(await request('skills.get', { name: fields.name }), saved);
    const template = await request('templates.save', { title: 'HTTP 模板', description: '模板路由验收', body: '# 模板正文' });
    assert.deepEqual(await request('templates.list'), [template.template]);
    assert.deepEqual(await request('templates.get', { id: template.template.id }), template);
    const refused = await fetch(`${origin}/__suo/request`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Suo-Token': 'invalid' }, body: JSON.stringify({ method: 'skills.save', payload: info('untrusted') }) });
    assert.equal(refused.status, 403);
    assert.equal((await readdir(writableRoot)).includes('untrusted'), false);
    assert.match(await readFile(join(writableRoot, fields.name, 'SKILL.md'), 'utf8'), /http-research/);
  } finally {
    if (server) await server.close();
    for (const name of names) previous[name] === undefined ? delete process.env[name] : process.env[name] = previous[name];
  }
});
