import test from 'node:test';
import assert from 'node:assert/strict';
import { Chat, describeError } from '../bridge/chat.mjs';
import { checkConnection } from '../bridge/connections.mjs';

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
