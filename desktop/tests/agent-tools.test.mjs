import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Chat } from '../bridge/chat.mjs';
import { guardedFetch, listSkills, publicAddress, readSkill } from '../bridge/agent.mjs';
import { createTestDirectory } from './helpers/test-data.mjs';

const root = process.env.SUO_DESKTOP_ENGINE ?? fileURLToPath(new URL('../../', import.meta.url));
const { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall } = await import(pathToFileURL(join(root, 'node_modules/@earendil-works/pi-ai/dist/providers/faux.js')).href);
const config = { providers: { scripted: { api: 'openai-completions', baseUrl: 'https://scripted.invalid/v1', apiKey: 'scripted-key', models: [{ id: 'scripted', name: 'scripted', contextWindow: 32768, maxTokens: 1024 }] } } };

// An agent run against the engine's scripted provider. `answer` plays the interface for ui requests.
function run(steps, answer, options = {}) {
  const core = createFauxCore({ provider: 'scripted', models: [{ id: 'scripted' }] });
  const requests = [], events = [];
  core.setResponses(steps.map(step => context => { requests.push(context.messages); return step; }));
  const chat = new Chat({
    root, connections: { load: async () => config }, skillsRoot: options.skillsRoot, fetchImpl: options.fetchImpl,
    emit: (event, data) => {
      events.push({ event, data });
      if (event === 'ui-request') Promise.resolve().then(() => answer(data.kind, data.payload))
        .then(result => chat.reply({ requestId: data.requestId, result }), error => chat.reply({ requestId: data.requestId, error: error.message }));
    },
    runtimeFactory: async () => ({ getModel: (provider, id) => ({ ...config.providers.scripted.models[0], id, provider, api: 'openai-completions', input: ['text'] }), streamSimple: core.streamSimple }),
  });
  chat.start({ workspaceId: randomUUID(), message: '帮我把需求拆解到画布上', history: [], selected: [] });
  return { chat, requests, events, done: chat.active.done };
}
const settled = events => events.find(item => item.event === 'run-settled').data;

test('a tool call reaches the interface, its result goes back to the model, and the reply continues', async () => {
  const cards = [{ key: 'p', title: '问题', content: '重复录入' }, { key: 'u', title: '用户', content: '运营' }];
  const h = run([
    fauxAssistantMessage([fauxText('我来整理。'), fauxToolCall('board_write', { group: '需求拆解', cards, links: [{ from: 'u', to: 'p' }] }, { id: 'call-1' })], { stopReason: 'toolUse' }),
    fauxAssistantMessage('已放到画布。'),
  ], (kind, payload) => {
    assert.equal(kind, 'board.write');
    assert.deepEqual(payload.cards, cards);
    return { created: [{ key: 'p', id: 'aaaa1111' }, { key: 'u', id: 'bbbb2222' }], group: 'cccc3333', links: 1 };
  });
  await h.done;
  const steps = h.events.filter(item => item.event === 'tool-step').map(item => item.data);
  assert.deepEqual(steps.map(step => [step.label, step.status]), [['整理画布「需求拆解」', 'running'], ['整理画布「需求拆解」', 'done']]);
  assert.match(steps[1].detail, /已放置 2 张卡片/);
  const toolResult = h.requests[1].find(message => message.role === 'toolResult');
  assert.match(toolResult.content[0].text, /p=aaaa1111/);
  assert.equal(h.events.filter(item => item.event === 'text-delta').map(item => item.data.delta).join(''), '我来整理。\n\n已放到画布。');
  assert.deepEqual(settled(h.events), { runId: settled(h.events).runId, workspaceId: settled(h.events).workspaceId, cancelled: false, boardTouched: true });
});

test('a failed interface action is reported to the model, which can still answer', async () => {
  const h = run([
    fauxAssistantMessage(fauxToolCall('board_edit', { changes: [{ action: 'remove', id: 'user0001' }] }, { id: 'call-1' }), { stopReason: 'toolUse' }),
    fauxAssistantMessage('那张卡片是你创建的，我没有删除。'),
  ], () => { throw new Error('只能删除 Suo 创建的卡片'); });
  await h.done;
  assert.equal(h.events.find(item => item.event === 'tool-step' && item.data.status === 'error').data.label, '调整画布');
  assert.equal(h.requests[1].find(message => message.role === 'toolResult').isError, true);
  assert.equal(settled(h.events).error, undefined);
  assert.equal(settled(h.events).boardTouched, false);
});

test('stopping while the interface is busy ends the run and the late answer is ignored', async () => {
  let late;
  const h = run([fauxAssistantMessage(fauxToolCall('board_read', {}, { id: 'call-1' }), { stopReason: 'toolUse' }), fauxAssistantMessage('不应出现')], () => new Promise(() => {}));
  const chat = h.chat;
  await new Promise(resolve => { const timer = setInterval(() => { const request = h.events.find(item => item.event === 'ui-request'); if (request) { late = request.data.requestId; clearInterval(timer); resolve(); } }, 5); });
  assert.deepEqual(chat.abort(), { stopped: true });
  await h.done;
  assert.equal(settled(h.events).cancelled, true);
  assert.deepEqual(chat.reply({ requestId: late, result: { cards: [] } }), { accepted: false });
  assert.equal(h.events.filter(item => item.event === 'text-delta').length, 0);
});

test('skills are listed from their front matter and only files inside a skill folder can be read', async () => {
  const skills = await createTestDirectory('skills-');
  await mkdir(join(skills, 'demand', 'references'), { recursive: true });
  await writeFile(join(skills, 'demand', 'SKILL.md'), '---\nname: demand-breakdown\ndisplay_name: 需求拆解\ndescription: "把一句话需求拆成问题、用户和假设"\n---\n# 步骤\n先问用户是谁。');
  await writeFile(join(skills, 'demand', 'references', 'cards.md'), '卡片结构：问题 / 用户 / 假设');
  await writeFile(join(skills, 'secret.md'), '不应读取');
  assert.deepEqual(await listSkills(skills), [{ name: 'demand-breakdown', title: '需求拆解', description: '把一句话需求拆成问题、用户和假设', folder: 'demand' }]);
  const skill = await readSkill(skills, 'demand-breakdown');
  assert.match(skill.text, /先问用户是谁/);
  assert.deepEqual(skill.files, ['references/cards.md']);
  assert.match((await readSkill(skills, 'demand-breakdown', 'references/cards.md')).text, /卡片结构/);
  await assert.rejects(readSkill(skills, 'demand-breakdown', '../secret.md'), /技能目录/);
  await assert.rejects(readSkill(skills, 'missing'), /没有名为/);
  assert.deepEqual(await listSkills(join(skills, 'none')), []);

  const h = run([fauxAssistantMessage(fauxToolCall('use_skill', { name: 'demand-breakdown' }, { id: 'call-1' }), { stopReason: 'toolUse' }), fauxAssistantMessage('好的')], () => ({}), { skillsRoot: skills });
  await h.done;
  assert.match(h.requests[0][0].content, /demand-breakdown：把一句话需求拆成问题、用户和假设/);
  assert.match(h.requests[1].find(message => message.role === 'toolResult').content[0].text, /references\/cards\.md/);
});

test('web pages must be public: local and private addresses are refused, also after a redirect', async () => {
  const resolve = async host => [{ address: { 'public.example': '93.184.216.34', 'intranet.example': '10.0.0.8', 'mapped.example': '::ffff:127.0.0.1' }[host] ?? '203.0.113.9' }];
  for (const url of ['http://localhost:1420/', 'http://127.0.0.1/', 'http://[::1]/', 'http://192.168.1.1/', 'http://100.101.225.50/', 'http://intranet.example/', 'http://mapped.example/', 'file:///etc/hosts', 'http://user:pass@public.example/']) {
    await assert.rejects(publicAddress(url, resolve), /本机或局域网|公开的/, url);
  }
  assert.equal((await publicAddress('https://public.example/a', resolve)).host, 'public.example');
  const hops = [];
  const fetchImpl = async url => { hops.push(url); return url.includes('public') ? new Response('', { status: 302, headers: { location: 'http://192.168.0.1/admin' } }) : new Response('secret'); };
  await assert.rejects(guardedFetch(fetchImpl, resolve)('https://public.example/'), /本机或局域网/);
  assert.deepEqual(hops, ['https://public.example/']);
});

test('web search results are listed for the model, and thin pages are re-read in the hidden browser', async () => {
  const search = run([fauxAssistantMessage(fauxToolCall('web_search', { query: 'AI 产品经理 工具' }, { id: 'call-1' }), { stopReason: 'toolUse' }), fauxAssistantMessage('找到了')],
    (kind, payload) => { assert.equal(kind, 'web.search'); assert.equal(payload.query, 'AI 产品经理 工具'); return { engine: '必应', results: [{ title: '工具清单', url: 'https://example.com/list', snippet: '十个常用工具' }] }; });
  await search.done;
  assert.equal(search.events.find(item => item.event === 'tool-step').data.label, '联网搜索「AI 产品经理 工具」');
  assert.deepEqual(search.events.filter(item => item.event === 'tool-step').at(-1).data.refs, ['工具清单 https://example.com/list'], 'the found pages stay with the step for later turns');
  assert.match(search.requests[1].find(message => message.role === 'toolResult').content[0].text, /必应搜索「AI 产品经理 工具」的结果：\n1\. 工具清单\n   https:\/\/example\.com\/list\n   十个常用工具/);

  const shell = async () => new Response('<html><head><title>应用</title></head><body><div id="app"></div></body></html>', { headers: { 'content-type': 'text/html' } });
  const page = 'http://93.184.216.34/app';
  const rendered = run([fauxAssistantMessage(fauxToolCall('web_fetch', { url: page }, { id: 'call-1' }), { stopReason: 'toolUse' }), fauxAssistantMessage('读完了')],
    kind => { assert.equal(kind, 'web.read'); return { title: '应用', url: page, text: '脚本渲染出的正文。'.repeat(40) }; }, { fetchImpl: shell });
  await rendered.done;
  assert.match(rendered.requests[1].find(message => message.role === 'toolResult').content[0].text, /脚本渲染出的正文/);

  const preview = run([fauxAssistantMessage(fauxToolCall('web_fetch', { url: page }, { id: 'call-1' }), { stopReason: 'toolUse' }), fauxAssistantMessage('读完了')],
    () => { throw new Error('浏览器读取需要在桌面 App 中使用。'); }, { fetchImpl: shell });
  await preview.done;
  const result = preview.requests[1].find(message => message.role === 'toolResult');
  assert.equal(result.isError, false); assert.match(result.content[0].text, /Title: 应用/);
});

test('a model that refuses tools answers without them, and later runs skip the tools', async () => {
  const core = createFauxCore({ provider: 'scripted', models: [{ id: 'scripted' }] });
  const seen = [], events = [];
  // The agent declares its prompt and tools as system messages in the transcript.
  const system = context => (context.messages ?? []).filter(item => item.role === 'system');
  const answer = message => context => {
    seen.push({ tools: (context.tools?.length ?? 0) + system(context).flatMap(item => item.toolsAdded ?? []).length, prompt: [context.systemPrompt ?? '', ...system(context).map(item => String(item.content))].join('\n') });
    return message;
  };
  core.setResponses([
    answer(fauxAssistantMessage([], { stopReason: 'error', errorMessage: '400 tools is not supported for this model' })),
    answer(fauxAssistantMessage('先在对话里回答。')),
    answer(fauxAssistantMessage('第二次也只聊天。')),
  ]);
  const chat = new Chat({ root, connections: { load: async () => config }, emit: (event, data) => events.push({ event, data }),
    runtimeFactory: async () => ({ getModel: (provider, id) => ({ ...config.providers.scripted.models[0], id, provider, api: 'openai-completions', input: ['text'] }), streamSimple: core.streamSimple }) });
  for (const message of ['帮我拆解需求', '再整理一下']) {
    chat.start({ workspaceId: randomUUID(), message, history: [], selected: [] });
    await chat.active.done;
  }
  assert.deepEqual(seen.map(item => item.tools > 0), [true, false, false]);
  assert.match(seen[1].prompt, /不支持工具调用/);
  const settledRuns = events.filter(item => item.event === 'run-settled').map(item => item.data);
  assert.deepEqual(settledRuns.map(item => item.error), [undefined, undefined]);
  assert.equal(events.filter(item => item.event === 'context-info' && /不支持工具调用/.test(item.data.contextNote)).length, 2);
});

test('a question with options ends the run and waits for the user', async () => {
  const options = [{ label: 'B 端产品经理', description: '先做团队协作' }, { label: '个人用户' }];
  const h = run([fauxAssistantMessage(fauxToolCall('ask_user', { question: '主要给谁用？', options }, { id: 'call-1' }), { stopReason: 'toolUse' }), fauxAssistantMessage('不应出现')],
    (kind, payload) => { assert.equal(kind, 'ask.user'); assert.equal(payload.question, '主要给谁用？'); assert.deepEqual(payload.options, options); return { shown: true }; });
  await h.done;
  assert.equal(h.requests.length, 1, 'the model is not called again after asking');
  assert.equal(settled(h.events).error, undefined);
  assert.equal(h.events.filter(item => item.event === 'tool-step').length, 0, 'the question shows as options, not as a step');
  const bad = run([fauxAssistantMessage(fauxToolCall('ask_user', { question: '选哪个？', options: [{ label: '只有一个' }] }, { id: 'call-1' }), { stopReason: 'toolUse' }), fauxAssistantMessage('那我直接做。')], () => assert.fail('no question with one option'));
  await bad.done;
  assert.equal(bad.requests.length, 2);
});
