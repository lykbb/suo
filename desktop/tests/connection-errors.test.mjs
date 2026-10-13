import test from 'node:test';
import assert from 'node:assert/strict';
import { Chat, describeError } from '../bridge/chat.mjs';
import { checkConnection, listModels, Connections } from '../bridge/connections.mjs';
import { PRESETS, presetFor, recommendedModel } from '../src/modelPresets.ts';
import { createTestDirectory } from './helpers/test-data.mjs';

const key = 'sk-test-0123456789abcdefghijklmnop';
const listing = ids => async () => new Response(JSON.stringify({ data: ids.map(id => ({ id })) }), { status: 200 });

test('errors keep the provider reason and status but never the key', () => {
  const retired = describeError(new Error('404 The model `agnes-2.0-flash` does not exist'), key);
  assert.match(retired, /没有这个模型/); assert.match(retired, /HTTP 404/); assert.match(retired, /agnes-2\.0-flash/);
  const echoed = describeError(new Error(`401 Incorrect API key provided: ${key}`), key);
  assert.match(echoed, /认证失败/); assert(!echoed.includes(key)); assert(!echoed.includes('0123456789abcdef'));
  assert.match(describeError(new Error('429 You exceeded your current quota'), key), /额度不足.*HTTP 429/);
  assert.match(describeError(new TypeError('fetch failed')), /连不上模型接口/);
  assert.match(describeError(new Error('Unknown model')), /重新选择模型/);
});

test('saving checks the model against the endpoint list', async () => {
  const base = { api: 'openai-completions', baseUrl: 'https://api.example.test/v1', apiKey: key };
  assert.deepEqual(await checkConnection({ ...base, modelId: 'agnes-2.5-flash' }, listing(['agnes-2.5-flash', 'agnes-3.0-flash'])), {});
  await assert.rejects(checkConnection({ ...base, modelId: 'agnes-2.0-flash' }, listing(['agnes-2.5-flash', 'agnes-3.0-flash'])), /没有「agnes-2\.0-flash」.*agnes-2\.5-flash、agnes-3\.0-flash/);
  await assert.rejects(checkConnection({ ...base, modelId: 'x' }, async () => new Response('{}', { status: 401 })), /API Key 无效.*401/);
  // No list on this endpoint, or unreachable right now: saved, with a warning only when unreachable.
  assert.deepEqual(await checkConnection({ ...base, modelId: 'x' }, async () => new Response('nope', { status: 404 })), {});
  const offline = await checkConnection({ ...base, modelId: 'x' }, async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ETIMEDOUT' } }); });
  assert.match(offline.warning, /ETIMEDOUT/); assert(!offline.warning.includes('example.test'));
});

test('anthropic endpoints are checked with their own headers', async () => {
  let seen;
  await checkConnection({ api: 'anthropic-messages', baseUrl: 'https://api.example.test/v1', apiKey: key, modelId: 'm' }, async (_url, init) => { seen = init.headers; return new Response(JSON.stringify({ data: [{ id: 'm' }] })); });
  assert.equal(seen['x-api-key'], key); assert.equal(seen.Authorization, undefined);
});

// "测试连接" with a stand-in model: `answers` is what each request returns, in order.
function tester(answers) {
  const calls = [];
  const config = { providers: { p: { api: 'openai-completions', baseUrl: 'https://api.example.test/v1', apiKey: key, models: [{ id: 'm', name: 'm' }] } } };
  const chat = new Chat({ root: '/nowhere', connections: { load: async () => config }, emit: () => {},
    runtimeFactory: async () => ({ getModel: (provider, id) => ({ id, provider, api: 'openai-completions', input: ['text'] }),
      streamSimple: (model, context, options) => { calls.push({ context, options }); const answer = answers.shift(); return { result: async () => answer }; } }) });
  return { chat, calls };
}

test('the connection test tells a working model, one without tools and a failing one apart', async () => {
  const working = tester([{ stopReason: 'stop' }]);
  assert.deepEqual({ ...await working.chat.check({ provider: 'p', id: 'm' }), ms: 0 }, { ok: true, tools: true, ms: 0 });
  assert.deepEqual(working.calls[0].context.tools.map(tool => tool.name), ['ping']);
  assert.equal(working.calls[0].options.apiKey, key); assert.equal(working.calls[0].options.maxTokens, 32);

  const plain = tester([{ stopReason: 'error', errorMessage: '400 tools is not supported for this model' }, { stopReason: 'stop' }]);
  assert.equal((await plain.chat.check({ provider: 'p', id: 'm' })).tools, false);
  assert.equal(plain.calls.length, 2); assert.equal(plain.calls[1].context.tools, undefined);

  const refused = tester([{ stopReason: 'error', errorMessage: `401 Incorrect API key provided: ${key}` }]);
  const result = await refused.chat.check({ provider: 'p', id: 'm' });
  assert.equal(result.ok, false); assert.match(result.message, /认证失败/); assert(!result.message.includes(key));
  assert.equal(refused.calls.length, 1);

  const missing = tester([]);
  assert.match((await missing.chat.check({ provider: 'p', id: 'gone' })).message, /重新选择模型/);
  assert.equal(missing.calls.length, 0);
  missing.chat.active = {};
  await assert.rejects(missing.chat.check({ provider: 'p', id: 'm' }), /先停止当前回复/);
});

test('the model picker lists chat models, explains failures and reaches Anthropic at /v1/models', async () => {
  const seen = [];
  const listing = ids => async url => { seen.push(String(url)); return new Response(JSON.stringify({ data: ids.map(id => ({ id })) }), { status: 200 }); };
  const base = { api: 'openai-completions', baseUrl: 'https://api.example.test/v1', apiKey: key };
  assert.deepEqual((await listModels(base, listing(['chat-model', 'reasoner-model', 'text-embedding-3', 'whisper-1']))).models, ['chat-model', 'reasoner-model']);
  await assert.rejects(listModels(base, async () => new Response('', { status: 401 })), /API Key 无效.*401/);
  await assert.rejects(listModels(base, async () => new Response('nope', { status: 404 })), /没有提供模型列表（HTTP 404）.*手动填写/);
  await assert.rejects(listModels(base, async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); }), /连不上这个接口（ENOTFOUND）/);
  await listModels({ ...base, api: 'anthropic-messages', baseUrl: 'https://api.anthropic.test' }, listing(['claude-sonnet-x']));
  assert.equal(seen.at(-1), 'https://api.anthropic.test/v1/models');
});

test('a saved key is reused to list models only for the same address', async () => {
  const root = await createTestDirectory('discover-'), sent = [];
  const fetchImpl = async (url, init) => { sent.push({ url: String(url), auth: init?.headers?.Authorization }); return new Response(JSON.stringify({ data: [{ id: 'fixture' }] }), { status: 200 }); };
  const connections = new Connections({ root, dataRoot: root, fetch: fetchImpl });
  const saved = await connections.configure({ baseUrl: 'https://api.example.test/v1', modelId: 'fixture', apiKey: key });
  const provider = saved.selected.provider;
  assert.deepEqual((await connections.discover({ provider, baseUrl: 'https://api.example.test/v1/', api: 'openai-completions' })).models, ['fixture']);
  assert.equal(sent.at(-1).auth, `Bearer ${key}`);
  const before = sent.length;
  await assert.rejects(connections.discover({ provider, baseUrl: 'https://other.example.test/v1', api: 'openai-completions' }), /请先填写 API Key/);
  assert.equal(sent.length, before, 'the saved key is not sent to another address');
  await assert.rejects(connections.discover({ baseUrl: 'not a url', apiKey: key }), /接口地址格式不正确/);
});

test('service presets carry public addresses only and pick a sensible default from the listed models', () => {
  assert(PRESETS.every(item => /^https:\/\//.test(item.baseUrl) && /^https:\/\//.test(item.keyUrl) && !/key=|sk-/i.test(item.baseUrl + item.keyUrl)));
  const first = PRESETS[0];
  assert.equal(presetFor(first.baseUrl + '/'), first);
  assert.equal(recommendedModel(presetFor(first.baseUrl), ['some-reasoner', first.prefer[0]]), first.prefer[0]);
  assert.equal(recommendedModel(presetFor('https://api.anthropic.com'), ['claude-opus-x', 'claude-sonnet-y']), 'claude-sonnet-y');
  assert.equal(recommendedModel(undefined, ['anything']), undefined);
});
