import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Chat, loadAgentInstructions, systemPrompt } from '../bridge/chat.mjs';
import { createFauxCore, fauxAssistantMessage } from '../../node_modules/@earendil-works/pi-ai/dist/providers/faux.js';
import { Connections, connectionCatalog, defaultModel, normalizeConnections } from '../bridge/connections.mjs';

const makeModel = id => ({ id, name: id, contextWindow: 32768, maxTokens: 512 });
const configuration = () => ({
  providers: {
    first: { api: 'openai-completions', baseUrl: 'https://first.example/v1', apiKey: 'first-test-key', models: [makeModel('fast'), makeModel('large')] },
    second: { api: 'anthropic-messages', baseUrl: 'https://second.example/v1', apiKey: 'second-test-key', models: [makeModel('alternate')] },
  },
  selected: { provider: 'second', id: 'alternate' },
});
const payload = model => ({ workspaceId: randomUUID(), runId: randomUUID(), message: '梳理需求', ...(model ? { model } : {}) });

function harness(config, failure = false) {
  const streams = [], events = [], factories = [];
  // The engine's scripted provider answers in the real stream format the agent loop expects.
  const core = createFauxCore({ provider: 'scripted', models: [{ id: 'scripted' }] });
  core.setResponses([failure ? fauxAssistantMessage('', { stopReason: 'error', errorMessage: '401 Unauthorized' }) : fauxAssistantMessage('收到')]);
  const chat = new Chat({
    root: fileURLToPath(new URL('../../', import.meta.url)), connections: { load: async () => config },
    emit: (event, data) => events.push({ event, data }),
    runtimeFactory: async value => {
      factories.push(value);
      return {
        getModel(provider, id) {
          const entry = value.providers[provider];
          const model = entry?.models.find(item => item.id === id);
          return model ? { ...model, provider, api: entry.api } : undefined;
        },
        streamSimple(model, context, options) {
          streams.push({ model, context, options });
          return core.streamSimple(model, context, options);
        },
      };
    },
  });
  return { chat, streams, events, factories };
}

test('Best resolves the configured selection and safely falls back when that selection disappeared', () => {
  const config = configuration();
  assert.deepEqual(defaultModel(config), { provider: 'second', id: 'alternate' });
  config.selected.id = 'removed';
  assert.deepEqual(defaultModel(config), { provider: 'first', id: 'fast' });
  delete config.selected;
  assert.deepEqual(defaultModel(config), { provider: 'first', id: 'fast' });
  assert.equal(defaultModel({ providers: {} }), undefined);
});

test('the public catalog exposes the actual default without credentials and normalization preserves only valid selections', () => {
  const config = configuration();
  const catalog = connectionCatalog(config);
  assert.deepEqual(catalog.selected, config.selected);
  assert(!JSON.stringify(catalog).includes('test-key'));
  assert.deepEqual(normalizeConnections(config).selected, config.selected);
  config.selected = { provider: 'second', id: 'removed', apiKey: 'never-copy' };
  assert.equal(normalizeConnections(config).selected, undefined);
  config.selected = { provider: 'second', id: 'alternate', apiKey: 'never-copy' };
  assert.deepEqual(normalizeConnections(config).selected, { provider: 'second', id: 'alternate' });
});

test('saving a connection also persists its selected default without removing the other providers', async () => {
  const connections = new Connections({ root: '.', dataRoot: '.', fetch: async () => new Response(JSON.stringify({ data: [{ id: 'fast' }] })) });
  connections.load = async () => configuration();
  let saved;
  connections.saveLocked = async value => { saved = value; return connectionCatalog(value); };
  const catalog = await connections.configureLocked({ provider: 'first', baseUrl: 'https://first.example/v1', api: 'openai-completions', modelId: 'fast', apiKey: '' });
  assert.deepEqual(saved.selected, { provider: 'first', id: 'fast' });
  assert.deepEqual(catalog.selected, saved.selected);
  assert(saved.providers.second);
  assert.equal(saved.providers.first.apiKey, 'first-test-key');
});

test('a new conversation can send with Best without a fabricated best model ID, with the workbench tools', async () => {
  const result = harness(configuration());
  result.chat.start(payload());
  await result.chat.active.done;
  assert.equal(result.streams.length, 1);
  const sent = result.streams[0];
  assert.equal(sent.model.provider, 'second');
  assert.equal(sent.model.id, 'alternate');
  assert.equal(sent.options.apiKey, 'second-test-key');
  const system = sent.context.messages[0];
  assert.equal(system.role, 'system');
  // The role from agent.md sits inside the system prompt, followed by the skill list.
  const role = systemPrompt([], await loadAgentInstructions(fileURLToPath(new URL('../../', import.meta.url))));
  assert(String(system.content).startsWith(role));
  assert.deepEqual(system.toolsAdded.map(tool => tool.name).sort(), ['ask_user', 'board_edit', 'board_organize', 'board_read', 'board_write', 'document_write', 'read_material', 'search_materials', 'use_skill', 'web_fetch', 'web_search']);
  assert.equal(result.events.at(-1).data.error, undefined);
});

test('an existing explicit model remains selected even when the configured default is different', async () => {
  const result = harness(configuration());
  result.chat.start(payload({ provider: 'first', id: 'large' }));
  await result.chat.active.done;
  assert.equal(result.streams.length, 1);
  assert.equal(result.streams[0].model.id, 'large');
  assert.equal(result.streams[0].options.apiKey, 'first-test-key');
});

test('an invalid explicit choice never silently uses Best or sends a request', async () => {
  const result = harness(configuration());
  result.chat.start(payload({ provider: 'first', id: 'removed' }));
  await result.chat.active.done;
  assert.equal(result.factories.length, 0);
  assert.equal(result.streams.length, 0);
  assert.match(result.events.at(-1).data.error, /重新选择模型/);
});

test('Best with no configured models gives a settings error and makes no model call', async () => {
  const result = harness({ providers: {} });
  result.chat.start(payload());
  await result.chat.active.done;
  assert.equal(result.factories.length, 0);
  assert.equal(result.streams.length, 0);
  assert.equal(result.events.at(-1).data.error, '还没有配置模型，请在设置中添加模型连接。');
  assert.equal(result.events.filter(item => item.event === 'run-settled').length, 1);
});

test('a default-model failure does not retry, switch provider, or reveal its credentials', async () => {
  const result = harness(configuration(), true);
  result.chat.start(payload());
  await result.chat.active.done;
  assert.equal(result.streams.length, 1);
  assert.equal(result.streams[0].options.maxRetries, 0);
  assert.match(result.events.at(-1).data.error, /认证失败/);
  assert(!JSON.stringify(result.events).includes('test-key'));
});
