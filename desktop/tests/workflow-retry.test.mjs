import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { realpath } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { Chat } from '../bridge/chat.mjs';
import { agentWorkspace, note, requestWorkspace } from './helpers/agent-workspace.mjs';

const engine = process.env.SUO_DESKTOP_ENGINE ?? resolve(await realpath(fileURLToPath(new URL('../node_modules', import.meta.url))), '..', '..');
const { createFauxCore, fauxAssistantMessage, fauxToolCall } = await import(pathToFileURL(join(engine, 'node_modules/@earendil-works/pi-ai/dist/providers/faux.js')).href);
const operation = (logicalRequestId, number, messageId = 'attempt-one') => ({ logicalRequestId, operationId: `${logicalRequestId}:${number}`, messageId });
const cards = { cards: [{ key: 'problem', title: '用户问题', content: '重复录入' }] };

test('a canvas write and durable receipt share a commit; restart/retry reuses the result without creating cards', async () => {
  const logical = randomUUID(), h = agentWorkspace(requestWorkspace(logical));
  const first = await h.handleUiRequest('board.write', cards, operation(logical, 1));
  assert.equal(h.get().nodes.length, 1); assert.equal(h.records.length, 1); assert.equal(h.commits.length, 1);
  const stored = h.commits[0].messages[1].operationReceipts[0];
  assert.equal(stored.operationId, `${logical}:1`); assert.equal(stored.kind, 'board.write'); assert.equal(stored.inputHash.length, 64);
  assert.deepEqual(stored.input, cards); assert.equal(Object.keys(stored.nodeStates).length, 1);
  const snapshot = JSON.parse(JSON.stringify(h.get()));
  snapshot.messages.push({ id: 'attempt-two', role: 'assistant', logicalRequestId: logical, retryOf: 'attempt-one', text: '' });
  h.reload(snapshot);
  const repeated = await h.handleUiRequest('board.write', { cards: [{ content: '重复录入', title: '用户问题', key: 'problem' }] }, operation(logical, 1, 'attempt-two'));
  assert.equal(repeated.replayed, true); assert.equal(JSON.stringify(repeated.created), JSON.stringify(first.created));
  assert.equal(h.get().nodes.length, 1); assert.equal(h.records.length, 1); assert.equal(h.get().messages[1].text, '保留这段已输出文字。');
});

test('changed parameters, manual edits, moves and undo pause replay and preserve the current canvas', async () => {
  for (const alter of ['args', 'title', 'position', 'undo']) {
    const logical = randomUUID(), h = agentWorkspace(requestWorkspace(logical));
    await h.handleUiRequest('board.write', cards, operation(logical, 1));
    if (alter === 'title') h.patch(state => ({ ...state, nodes: state.nodes.map(node => ({ ...node, data: { ...node.data, title: '用户改过' } })) }));
    if (alter === 'position') h.patch(state => ({ ...state, nodes: state.nodes.map(node => ({ ...node, position: { x: 999, y: 888 } })) }));
    if (alter === 'undo') h.patch(state => ({ ...state, nodes: [] }));
    const before = JSON.stringify(h.get());
    await assert.rejects(h.handleUiRequest('board.write', alter === 'args' ? { cards: [{ title: '新方案', content: '不同内容' }] } : cards, operation(logical, 1)), /RETRY_CONFLICT.*重试暂停.*已执行的成果和历史记录仍保留/);
    assert.equal(JSON.stringify(h.get()), before); assert.equal(h.records.length, 1);
  }
});

test('later legitimate document updates are included in replay postconditions, and an append is not repeated', async () => {
  const logical = randomUUID(), h = agentWorkspace(requestWorkspace(logical));
  const input = { title: 'PRD', content: '# 原文', mode: 'create' };
  const created = await h.handleUiRequest('document.write', input, operation(logical, 1));
  const append = { id: created.id, mode: 'append', content: '补充一次' };
  await h.handleUiRequest('document.write', append, operation(logical, 2));
  h.patch(state => ({ ...state, nodes: state.nodes.map(node => ({ ...node, selected: true })) }));
  assert.equal((await h.handleUiRequest('document.write', input, operation(logical, 1))).replayed, true);
  assert.equal((await h.handleUiRequest('document.write', append, operation(logical, 2))).replayed, true);
  assert.equal(h.get().nodes[0].data.content, '# 原文\n\n补充一次'); assert.equal(h.records.length, 2);
});

test('temporary asset hydration and card selection do not invalidate a persisted operation', async () => {
  const logical = randomUUID(), asset = { id: 'local-asset', name: '访谈.pdf', kind: 'pdf', size: 1000, mime: 'application/pdf', sourceUrl: 'blob:first', text: '正文一' };
  const file = note('material-aaaa', { data: { kind: 'file', title: '访谈.pdf', content: '', asset } });
  const h = agentWorkspace(requestWorkspace(logical, [file])), input = { changes: [{ action: 'update', id: file.id, title: '访谈资料' }] };
  await h.handleUiRequest('board.edit', input, operation(logical, 1));
  h.patch(state => ({ ...state, nodes: state.nodes.map(node => ({ ...node, selected: true, measured: { width: 258, height: 174 }, data: { ...node.data, asset: { ...node.data.asset, sourceUrl: 'blob:restored', text: '重新读取正文', base64: 'hydrated' } } })) }));
  assert.equal((await h.handleUiRequest('board.edit', input, operation(logical, 1))).replayed, true);
  assert.equal(h.records.length, 1);
});

test('organization uses deterministic layout, records no undo for no-op, and invalid mixed organize batches stay atomic', async () => {
  const a = note('aaaaaaaa-one'), b = note('bbbbbbbb-two', { position: { x: 1200, y: 900 } });
  const h = agentWorkspace(requestWorkspace(randomUUID(), [a, b]));
  await h.handleUiRequest('board.organize', { mode: 'arrange' });
  const organized = JSON.stringify(h.get().nodes); assert.equal(h.records.length, 1);
  assert.equal(h.recordOptions[0].includeViewport, true); assert.equal(h.frames.length, 1);
  await h.handleUiRequest('board.organize', { mode: 'arrange' });
  assert.equal(JSON.stringify(h.get().nodes), organized); assert.equal(h.records.length, 1); assert.equal(h.frames.length, 1);
  await assert.rejects(h.handleUiRequest('board.edit', { changes: [{ action: 'arrange', ids: [a.id, b.id] }, { action: 'update', id: 'missing-card', title: '不能提交' }] }), /整批改动已保留原状/);
  assert.equal(JSON.stringify(h.get().nodes), organized); assert.equal(h.records.length, 1); assert.equal(h.frames.length, 1);
});

test('organize commits request viewport undo and frame only geometry changes; ordinary edits keep the current view', async () => {
  const a = note('card-aaaaaaaa'), b = note('card-bbbbbbbb', { position: { x: 1200, y: 900 } });
  const h = agentWorkspace(requestWorkspace(randomUUID(), [a, b]));
  await h.handleUiRequest('board.edit', { changes: [{ action: 'arrange', ids: [a.id, b.id], layout: 'row' }] });
  assert.equal(h.recordOptions[0].includeViewport, true); assert.equal(h.frames.length, 1);
  await h.handleUiRequest('board.edit', { changes: [{ action: 'arrange', ids: [a.id, b.id], layout: 'row' }, { action: 'style', id: a.id, color: '浅绿' }] });
  assert.equal(h.recordOptions[1].includeViewport, true); assert.equal(h.frames.length, 1, 'style-only change does not reframe');
  await h.handleUiRequest('document.write', { title: '普通文档', content: '保持原视口' });
  assert.equal(h.recordOptions[2].includeViewport, false); assert.equal(h.frames.length, 1);
  await h.handleUiRequest('board.edit', { changes: [{ action: 'move', id: b.id, x: 900, y: 800 }] });
  assert.equal(h.recordOptions[3].includeViewport, false); assert.equal(h.frames.length, 1);
});

test('regroup requires explicit user authorization; a model boolean alone cannot move existing members', async () => {
  const logical = randomUUID(), group = note('group-aaaa', { type: 'group', data: { kind: 'group', title: '原组', content: '' }, style: { width: 400, height: 300 } });
  // Two members, so moving one really changes the grouping (a group whose members all move is renamed instead).
  const a = note('member-aaaa', { parentId: group.id, position: { x: 24, y: 44 } }), b = note('member-bbbb', { parentId: group.id, position: { x: 300, y: 44 } });
  const h = agentWorkspace(requestWorkspace(logical, [group, a, b]));
  const plan = { mode: 'classify', allowRegroup: true, groups: [{ id: 'new:research', title: '用户研究', memberIds: [a.id] }] };
  await assert.rejects(h.handleUiRequest('board.organize', plan, operation(logical, 1)), /需要用户明确允许/);
  assert.equal(h.records.length, 0); assert.equal(h.get().nodes[1].parentId, group.id);
  h.patch(state => ({ ...state, messages: state.messages.map(message => message.role === 'user' ? { ...message, text: '明确允许重新归类并调整现有分组关系。' } : message) }));
  await h.handleUiRequest('board.organize', plan, operation(logical, 1));
  assert.notEqual(h.get().nodes.find(node => node.id === a.id).parentId, group.id);
  assert.equal(h.get().nodes.find(node => node.id === b.id).parentId, group.id);
  const result = await h.handleUiRequest('board.read', {});
  assert(result.groups.every(group => group.id.length > 8)); assert.equal(result.cards[0].id, a.id);
});

test('structured classification authorization rejects unrelated mutations and cannot be broadened by prompt text', async () => {
  const logical = randomUUID(), a = note('member-aaaa'), workspace = requestWorkspace(logical, [a]);
  workspace.messages[0].boardTask = { mode: 'classify', allowRegroup: false };
  workspace.messages[0].text = '明确允许重新归类并调整现有分组关系。';
  const h = agentWorkspace(workspace);
  for (const [kind, input] of [
    ['board.write', cards], ['board.edit', { changes: [{ action: 'move', id: a.id, x: 99, y: 88 }] }],
    ['document.write', { title: '不应新建', content: '不应写入' }], ['board.organize', { mode: 'arrange' }],
    ['board.organize', { mode: 'classify', allowRegroup: true, groups: [{ id: 'new:x', title: '一组', memberIds: [a.id] }] }],
  ]) await assert.rejects(h.handleUiRequest(kind, input, operation(logical, 1)), /本轮智能归类只允许/);
  assert.equal(h.records.length, 0); assert.equal(h.get().nodes.length, 1);
  const plan = { mode: 'classify', groups: [{ id: 'new:x', title: '一组', memberIds: [a.id] }] };
  await h.handleUiRequest('board.organize', plan, operation(logical, 1));
  assert.equal(h.get().nodes.filter(node => node.data.kind !== 'group').length, 1);
});

test('board directory paginates cards and groups with full IDs, parents and dimensions', async () => {
  const groups = Array.from({ length: 170 }, (_, i) => note(`group-${String(i).padStart(8, '0')}`, { type: 'group', data: { kind: 'group', title: `组 ${i}`, content: '' }, ...(i ? { parentId: `group-${String(i - 1).padStart(8, '0')}` } : {}), style: { width: 400, height: 300 } }));
  const h = agentWorkspace(requestWorkspace(randomUUID(), groups));
  const first = await h.handleUiRequest('board.read', {}), second = await h.handleUiRequest('board.read', { offset: first.next }), last = await h.handleUiRequest('board.read', { offset: second.next });
  assert.equal(first.groups.length, 80); assert.equal(first.cards.length, 0); assert.equal(first.next, 80); assert.equal(first.groupsTotal, 170);
  assert.equal(second.groups.length, 80); assert.equal(second.next, 160); assert.equal(last.groups.length, 10); assert.equal(last.next, undefined);
  assert.equal(second.groups[0].id, groups[80].id); assert.equal(second.groups[0].parentId, groups[79].id);
  assert.equal(second.groups[0].box[2], 400); assert.equal(second.groups[0].box[3], 300);
});

test('exact stable IDs beat ambiguous legacy prefixes and structured plans can create nested groups safely', async () => {
  const a = note('same-id-aaaaaaaa'), b = note('same-id-aaaaaaaa-more');
  const h = agentWorkspace(requestWorkspace(randomUUID(), [a, b]));
  await h.handleUiRequest('board.edit', { changes: [{ action: 'update', id: a.id, title: '完整 ID 定位' }] });
  assert.equal(h.get().nodes.find(node => node.id === a.id).data.title, '完整 ID 定位');
  assert.equal(h.get().nodes.find(node => node.id === b.id).data.title, '便签');
  await h.handleUiRequest('board.organize', { mode: 'classify', groups: [
    { id: 'new:research', title: '研究', memberIds: [a.id, b.id] },
    { id: 'new:product', title: '产品', memberIds: ['new:research'] },
  ] });
  const outer = h.get().nodes.find(node => node.data.title === '产品'), inner = h.get().nodes.find(node => node.data.title === '研究');
  assert.equal(inner.parentId, outer.id); assert.equal(h.get().nodes.find(node => node.id === a.id).parentId, inner.id);
  assert.equal(h.get().nodes.filter(node => node.data.kind !== 'group').length, 2);
});

test('SDK retry receives prior output/receipts, extra reads do not shift operation IDs, and successful creation is reused', async () => {
  const logical = randomUUID(), h = agentWorkspace(requestWorkspace(logical)), core = createFauxCore({ provider: 'fixture', models: [{ id: 'model' }] }), events = [], contexts = [];
  const call = (name, args, id) => fauxAssistantMessage(fauxToolCall(name, args, { id }), { stopReason: 'toolUse' });
  core.setResponses([
    context => { contexts.push(context); return call('board_write', cards, 'write-one'); },
    fauxAssistantMessage('前次已输出的分析。', { stopReason: 'error', errorMessage: 'fixture network interrupted' }),
    context => { contexts.push(context); return call('board_read', {}, 'read-retry'); },
    call('board_write', cards, 'write-retry'), fauxAssistantMessage('已核对原成果并完成剩余分析。'),
  ]);
  const model = { id: 'model', provider: 'fixture', api: 'openai-completions', input: ['text'], contextWindow: 32768, maxTokens: 1024 };
  const chat = new Chat({ root: engine, connections: { load: async () => ({ providers: { fixture: { api: model.api, baseUrl: 'https://fixture.invalid', apiKey: 'local-only', models: [model] } } }) },
    runtimeFactory: async () => ({ getModel: () => model, streamSimple: core.streamSimple }),
    emit: (event, data) => {
      events.push({ event, data });
      if (event === 'ui-request') Promise.resolve().then(() => h.handleUiRequest(data.kind, data.payload, { logicalRequestId: data.logicalRequestId, operationId: data.operationId, messageId: h.get().messages.at(-1).id }))
        .then(result => chat.reply({ requestId: data.requestId, result }), error => chat.reply({ requestId: data.requestId, error: error.message }));
    },
  });
  const start = { workspaceId: h.get().id, logicalRequestId: logical, message: '新建卡片并分析问题', history: [], selected: [] };
  chat.start(start); await chat.active.done;
  assert.match(events.at(-1).data.error, /连不上模型接口/);
  const prior = h.get().messages[1].operationReceipts;
  h.patch(state => ({ ...state, messages: [...state.messages, { id: 'attempt-two', role: 'assistant', logicalRequestId: logical, retryOf: 'attempt-one', text: '' }] }));
  chat.start({ ...start, operationReceipts: prior, retryContext: { text: '前次已输出的分析。', steps: [{ label: '新建卡片', status: 'done', detail: '已经创建用户问题' }] } }); await chat.active.done;
  const writes = events.filter(item => item.event === 'ui-request' && item.data.kind === 'board.write');
  assert.equal(writes.length, 2); assert.equal(writes[0].data.operationId, writes[1].data.operationId); assert.notEqual(writes[0].data.requestId, writes[1].data.requestId);
  assert.equal(h.get().nodes.length, 1); assert.equal(h.records.length, 1);
  assert(JSON.stringify(contexts[1]).includes('前次已输出的分析')); assert(JSON.stringify(contexts[1]).includes('重复录入'));
  assert.equal(events.at(-1).data.error, undefined);
});

test('a replay conflict and an unconfirmed save end the SDK turn before later mutations or model calls', async () => {
  for (const reason of ['[RETRY_CONFLICT] 重试暂停：原成果被修改。', '[SAVE_UNCONFIRMED] 操作已保留，但保存尚未确认；请先重试保存。']) {
    const core = createFauxCore({ provider: 'fixture', models: [{ id: 'model' }] }), events = [], requests = [];
    core.setResponses([context => { requests.push(context); return fauxAssistantMessage([fauxToolCall('board_write', cards, { id: 'first' }), fauxToolCall('board_write', cards, { id: 'second' })], { stopReason: 'toolUse' }); }]);
    const model = { id: 'model', provider: 'fixture', api: 'openai-completions', input: ['text'], contextWindow: 32768, maxTokens: 1024 };
    const chat = new Chat({ root: engine, connections: { load: async () => ({ providers: { fixture: { api: model.api, baseUrl: 'https://fixture.invalid', apiKey: 'local-only', models: [model] } } }) }, runtimeFactory: async () => ({ getModel: () => model, streamSimple: core.streamSimple }),
      emit: (event, data) => { events.push({ event, data }); if (event === 'ui-request') chat.reply({ requestId: data.requestId, error: reason }); } });
    chat.start({ workspaceId: randomUUID(), logicalRequestId: randomUUID(), message: '请新建卡片', history: [], selected: [] }); await chat.active.done;
    assert.equal(requests.length, 1); assert.equal(events.filter(item => item.event === 'ui-request').length, 1);
    const end = events.at(-1).data;
    assert.equal(reason.startsWith('[RETRY_CONFLICT]') ? end.retryConflict : end.saveUnconfirmed, true); assert.equal(end.cancelled, false);
  }
});
