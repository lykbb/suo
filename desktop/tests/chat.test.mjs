import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFile, readFile, readdir, stat, realpath } from 'node:fs/promises';
import { createTestDirectory } from './helpers/test-data.mjs';
import { dirname, resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Chat, makeContext, SYSTEM_PROMPT } from '../bridge/chat.mjs';
import { Connections, normalizeConnections } from '../bridge/connections.mjs';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const engine = process.env.SUO_DESKTOP_ENGINE ?? resolve(await realpath(join(desktop, 'node_modules')), '..', '..');
const secret = 'test-only-literal-key';
const config = url => ({ providers: { fixture: { api: 'openai-completions', baseUrl: url + '/v1', apiKey: secret, models: [{ id: 'fixture-model', name: '本地验收', reasoning: false, input: ['text'], contextWindow: 32768, maxTokens: 512, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } });
const payload = () => ({ workspaceId: randomUUID(), runId: randomUUID(), model: { provider: 'fixture', id: 'fixture-model' }, message: '请梳理产品需求', history: [{ role: 'user', text: '此前的问题' }, { role: 'assistant', text: '此前的回答' }], selected: [{ title: '访谈', content: '用户需要减少录入步骤' }] });
function provider(mode = 'normal') {
  const requests = [], timers = new Set();
  const server = createServer(async (req, res) => {
    const parts = []; for await (const part of req) parts.push(part);
    const body = JSON.parse(Buffer.concat(parts).toString());
    requests.push({ body, auth: req.headers.authorization, path: req.url });
    if (mode === 'error') { res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: secret, type: 'invalid_request_error', code: 'invalid_api_key' } })); return; }
    if (mode === 'empty') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end('data: ' + JSON.stringify({ id: 'chatcmpl-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n'); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const texts = mode === 'slow' ? Array.from({ length: 50 }, () => '持续回复') : ['已收到', '产品需求，', '建议先确认用户。'];
    let index = 0;
    const timer = setInterval(() => {
      if (index < texts.length) res.write('data: ' + JSON.stringify({ id: 'chatcmpl-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture-model', choices: [{ index: 0, delta: { content: texts[index++] }, finish_reason: null }] }) + '\n\n');
      else { clearInterval(timer); timers.delete(timer); res.write('data: ' + JSON.stringify({ id: 'chatcmpl-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture-model', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }) + '\n\ndata: [DONE]\n\n'); res.end(); }
    }, mode === 'slow' ? 100 : 12);
    timers.add(timer); res.once('close', () => { clearInterval(timer); timers.delete(timer); });
  });
  return { requests, async start() { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return 'http://127.0.0.1:' + server.address().port; }, async close() { for (const timer of timers) clearInterval(timer); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

test('real SDK transport streams history and selected text with one request', async () => {
  const api = provider(), url = await api.start(), events = [];
  try {
    const chat = new Chat({ root: engine, connections: { load: async () => config(url) }, emit: (event, data) => events.push({ event, data }), maxOutput: 256 });
    const started = chat.start(payload()), done = chat.active.done;
    assert.throws(() => chat.start(payload()), /停止/);
    await done;
    assert.equal(api.requests.length, 1);
    assert.equal(api.requests[0].auth, 'Bearer ' + secret);
    assert.equal(api.requests[0].path, '/v1/chat/completions');
    assert.equal(api.requests[0].body.max_tokens ?? api.requests[0].body.max_completion_tokens, 256);
    const serialized = JSON.stringify(api.requests[0].body);
    assert.match(serialized, /此前的问题/); assert.match(serialized, /此前的回答/); assert.match(serialized, /减少录入步骤/);
    assert.equal(events.filter(item => item.event === 'run-settled').length, 1);
    assert.equal(events.at(-1).data.error, undefined);
    assert.equal(events.filter(item => item.event === 'text-delta').map(item => item.data.delta).join(''), '已收到产品需求，建议先确认用户。');
    assert(events.every(item => item.data.runId === started.runId));
    assert(!JSON.stringify(events).includes(secret));
  } finally { await api.close(); }
});
test('abort before preparation sends zero requests and settles once', async () => {
  const events = [], api = provider(), url = await api.start();
  try {
    const chat = new Chat({ root: engine, connections: { load: async () => config(url) }, emit: (event, data) => events.push({ event, data }) });
    const run = chat.start(payload()), done = chat.active.done;
    assert.equal(chat.abort(run.runId).stopped, true); await done;
    assert.equal(api.requests.length, 0); assert.equal(events.length, 1); assert.equal(events[0].data.cancelled, true);
  } finally { await api.close(); }
});
test('abort during streaming prevents late deltas and next turn works', async () => {
  const api = provider('slow'), url = await api.start(), events = [];
  let first;
  const chunk = new Promise(resolve => { first = resolve; });
  try {
    const chat = new Chat({ root: engine, connections: { load: async () => config(url) }, emit: (event, data) => { events.push({ event, data }); if (event === 'text-delta') first(); } });
    const run = chat.start(payload()), done = chat.active.done; await chunk;
    chat.abort(run.runId); const count = events.length; await done;
    assert.equal(events.length, count); assert.equal(events.at(-1).data.cancelled, true);
    assert.equal(api.requests.length, 1); assert.equal(chat.active, undefined);
    const next = chat.start(payload()), nextDone = chat.active.done;
    assert.equal(chat.abort(run.runId).stopped, false);
    chat.abort(next.runId); await nextDone;
    assert.equal(events.filter(item => item.event === 'run-settled').length, 2);
  } finally { await api.close(); }
});
test('authentication failures never retry or expose the key', async () => {
  const api = provider('error'), url = await api.start(), events = [];
  try {
    const chat = new Chat({ root: engine, connections: { load: async () => config(url) }, emit: (event, data) => events.push({ event, data }) });
    chat.start(payload()); await chat.active.done;
    assert.equal(api.requests.length, 1);
    assert.match(events.at(-1).data.error, /认证失败/); assert(!JSON.stringify(events).includes(secret));
  } finally { await api.close(); }
});
test('timeout settles and unlocks; late callbacks stay suppressed', async () => {
  const api = provider('slow'), url = await api.start(), events = [];
  try {
    const chat = new Chat({ root: engine, connections: { load: async () => config(url) }, emit: (event, data) => events.push({ event, data }), runLimitMs: 150 });
    chat.start(payload()); await chat.active.done;
    assert.equal(events.filter(item => item.event === 'run-settled').length, 1); assert.match(events.at(-1).data.error, /超时/); assert.equal(chat.active, undefined);
  } finally { await api.close(); }
});
test('empty response is an error, no fabricated reply', async () => {
  const api = provider('empty'), url = await api.start(), events = [];
  try {
    const chat = new Chat({ root: engine, connections: { load: async () => config(url) }, emit: (event, data) => events.push({ event, data }) });
    chat.start(payload()); await chat.active.done;
    assert.match(events.at(-1).data.error, /没有返回文字/); assert.equal(events.filter(item => item.event === 'text-delta').length, 0);
  } finally { await api.close(); }
});
test('literal configuration only, catalog hides secrets, saved versions have private permissions', async () => {
  const root = await createTestDirectory('chat-tests-');
  const connections = new Connections({ root, dataRoot: root, fetch: async () => new Response(JSON.stringify({ data: [{ id: 'a' }, { id: 'b' }] })) });
  const configured = await connections.configure({ baseUrl: 'http://127.0.0.1:1/v1', modelId: 'a', apiKey: secret });
  assert.equal(configured.mode, 'ready'); assert(!JSON.stringify(configured).includes(secret)); assert.equal(configured.connections[0].baseUrl, 'http://127.0.0.1:1/v1');
  await connections.configure({ baseUrl: 'http://127.0.0.1:1/v1', modelId: 'b', apiKey: '' });
  const names = await readdir(connections.directory); assert.equal(names.length, 2);
  assert.equal((await stat(join(connections.directory, names[0]))).mode & 0o777, 0o600);
  const loaded = await connections.load(); assert.deepEqual(loaded.providers[configured.selected.provider].models.map(item => item.id), ['a', 'b']);
  assert.equal(Object.keys(normalizeConnections({ providers: { ...config('http://127.0.0.1').providers, unsafe: { ...config('http://127.0.0.1').providers.fixture, apiKey: '!cat /secret' } } }).providers).length, 1);
  await assert.rejects(connections.configure({ baseUrl: 'file:///tmp/x', modelId: 'a', apiKey: secret }));
});
test('context has stable Suo identity and excludes demo/error/cancelled turns', () => {
  const item = payload(); item.history.push({ role: 'assistant', text: '旧演示', demo: true }, { role: 'assistant', text: '坏回答', error: true });
  const context = makeContext(item, { ...config('http://localhost').providers.fixture.models[0], provider: 'fixture', api: 'openai-completions' });
  assert.equal(context.systemPrompt, SYSTEM_PROMPT); assert(!JSON.stringify(context).includes('旧演示')); assert(!JSON.stringify(context).includes('坏回答'));
});

test('the real SDK sends actual image data and complete PDF text to the local fixture', async () => {
  const api = provider(), url = await api.start(), events = [], settings = config(url);
  settings.providers.fixture.models[0].input = ['text', 'image'];
  try {
    const chat = new Chat({ root: engine, connections: { load: async () => settings }, emit: (event, data) => events.push({ event, data }) });
    const item = payload();
    item.selected = [{ title: 'research.pdf', content: '[第1页] Users need fewer manual steps.' }, { title: 'image.png', content: '实际图片', image: { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk9sAAAAASUVORK5CYII=' } }];
    chat.start(item); await chat.active.done;
    assert.equal(api.requests.length, 1);
    const content = api.requests[0].body.messages.at(-1).content;
    assert.match(content.find(block => block.type === 'text').text, /Users need fewer manual steps/);
    assert.equal(content.find(block => block.type === 'image_url').image_url.url, 'data:image/png;base64,' + item.selected[1].image.data);
    assert.equal(events.at(-1).data.error, undefined);
  } finally { await api.close(); }
});
