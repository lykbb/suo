import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const { Chat, makeContext } = await import(process.env.SUO_PROMPT_CHAT_MODULE ?? new URL('../bridge/chat.mjs', import.meta.url));
const root = process.env.SUO_DESKTOP_ENGINE ?? fileURLToPath(new URL('../../', import.meta.url));
const { createFauxCore, fauxAssistantMessage, fauxToolCall } = await import(pathToFileURL(join(root, 'node_modules/@earendil-works/pi-ai/dist/providers/faux.js')).href);
const model = { id: 'scripted', name: '本机验证', api: 'openai-completions', provider: 'scripted', input: ['text'], contextWindow: 32768, maxTokens: 1024 };

test('ordinary chat and skill output default to the conversation, with explicit board requests still supported', () => {
  const context = makeContext({ message: '帮我写一份 PRD', history: [], selected: [] }, model,
    [{ name: 'product', description: '产品经理技能' }]);
  assert.match(context.systemPrompt, /默认直接在对话里完整回答，不自动创建或修改画布卡片/);
  assert.match(context.systemPrompt, /只有用户明确要求放到画布/);
  assert.match(context.systemPrompt, /技能说明中的交付形式也不能扩大用户的画布操作要求/);
  assert.match(context.systemPrompt, /product：产品经理技能/);
});

async function run(message, responses, answer) {
  const core = createFauxCore({ provider: 'scripted', models: [{ id: model.id }] });
  const contexts = [], events = [];
  core.setResponses(responses.map(response => context => { contexts.push(context); return response; }));
  const chat = new Chat({ root,
    connections: { load: async () => ({ providers: { scripted: { api: model.api, baseUrl: 'https://scripted.invalid/v1', apiKey: 'fixture-only', models: [model] } } }) },
    emit: (event, data) => {
      events.push({ event, data });
      if (event === 'ui-request') Promise.resolve().then(() => answer(data.kind, data.payload))
        .then(result => chat.reply({ requestId: data.requestId, result }), error => chat.reply({ requestId: data.requestId, error: error.message }));
    },
    runtimeFactory: async () => ({ getModel: () => model, streamSimple: core.streamSimple }),
  });
  chat.start({ workspaceId: randomUUID(), message, history: [], selected: [] });
  await chat.active.done;
  return { events, contexts };
}

test('a long scripted response is streamed without generating a board request', async () => {
  const text = '# 产品方案\n\n' + '先明确用户问题，再验证核心假设。'.repeat(50);
  const h = await run('帮我分析这个想法', [fauxAssistantMessage(text)], () => assert.fail('ordinary response must not write the board'));
  assert.equal(h.events.some(item => item.event === 'ui-request' || item.event === 'cards-proposed'), false);
  assert.equal(h.events.filter(item => item.event === 'text-delta').map(item => item.data.delta).join(''), text);
  assert.equal(h.events.at(-1).data.boardTouched, false);
  assert.equal(h.events.at(-1).data.error, undefined);
});

test('an explicit board request can still create cards through the existing tool chain', async () => {
  const cards = [{ title: '用户问题', content: '重复录入资料' }];
  const h = await run('把这个问题放到画布上', [
    fauxAssistantMessage(fauxToolCall('board_write', { cards }, { id: 'call-board' }), { stopReason: 'toolUse' }),
    fauxAssistantMessage('已放到画布。'),
  ], (kind, payload) => {
    assert.equal(kind, 'board.write');
    assert.deepEqual(payload.cards, cards);
    return { created: [{ id: 'created-card' }], links: 0 };
  });
  assert.equal(h.events.filter(item => item.event === 'ui-request').length, 1);
  assert.equal(h.events.at(-1).data.boardTouched, true);
  assert.equal(h.events.at(-1).data.error, undefined);
});
