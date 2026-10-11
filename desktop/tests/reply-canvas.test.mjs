import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { hideSystemRecord, messageDisplayText } from '../src/messageError.mjs';
import { replyWithSources } from '../src/sourceLinks.ts';

const source = await readFile(process.env.SUO_ACTIONS_SOURCE ?? new URL('../src/actions.ts', import.meta.url), 'utf8');
const syntax = ts.createSourceFile('actions.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
const names = new Set(['newCard', 'commitCard', 'replyToCanvas', 'receive', 'replyTitle', 'copyMessage', 'endSteps']);
const declarations = syntax.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text));
assert.equal(declarations.length, names.size, 'the tests must exercise the real reply and editing functions');
const code = ts.transpileModule(declarations.map(node => node.getText(syntax)).join('\n'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness() {
  const run = { workspaceId: 'workspace-A', messageId: 'reply-A', runId: 'run-A' };
  const idea = { id: 'idea', type: 'card', selected: true, position: { x: 80, y: 120 }, data: { kind: 'note', title: '用户问题', content: '怎样减少重复录入？' } };
  let state = {
    busy: true,
    workspace: { id: run.workspaceId, nodes: [idea], edges: [], panels: {}, messages: [{ id: run.messageId, role: 'assistant', text: '' }] },
  };
  const session = { running: run, importing: false };
  const focused = [], notices = [], copied = [], entrances = new Map();
  let recorded = 0, flushed = 0;
  const context = {
    exports: {}, session, entrances, messageDisplayText, hideSystemRecord, replyWithSources, navigator: { clipboard: { writeText: async text => copied.push(text) } }, crypto: { randomUUID },
    app: { get: () => state, set: patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; } },
    update: change => { state = { ...state, workspace: change(state.workspace) }; },
    record: () => { recorded++; }, flush: async () => { flushed++; },
    notice: text => notices.push(text), focusCard: id => focused.push(id), reveal: () => {},
    freeSpot: (_nodes, position) => position,
  };
  vm.runInNewContext(code, context);
  const event = (name, data = {}) => context.exports.receive({ event: name, data: { workspaceId: run.workspaceId, runId: run.runId, ...data } });
  return {
    ...context.exports, event, get: () => state, set: context.app.set, run, session, focused, notices, copied, entrances,
    counts: () => ({ recorded, flushed }),
    replies: () => state.workspace.nodes.filter(node => node.data.replyId),
  };
}

test('a completed structured reply stays in the thread until the user places an editable document', () => {
  const h = harness();
  h.event('run-started');
  h.event('text-delta', { delta: '# 核心问题\n' });
  h.event('text-delta', { delta: '先访谈，再验证重复录入的频率。' });
  assert.equal(h.replies().length, 0, 'partial text stays in the conversation until completion');
  h.event('run-settled');
  assert.equal(h.replies().length, 0, 'completion does not create a card');
  h.replyToCanvas(h.run.messageId);
  const [card] = h.replies();
  assert.equal(h.replies().length, 1);
  assert.equal(card.data.kind, 'document');
  assert.equal(card.data.source, 'ai');
  assert.equal(card.data.replyId, h.run.messageId);
  assert.equal(card.data.title, '核心问题', 'the first heading names the card');
  assert.equal(card.data.content, '# 核心问题\n先访谈，再验证重复录入的频率。');
  assert.equal(card.data.asset, undefined, 'the result is editable document content');
  assert.equal(h.get().workspace.messages[0].text, card.data.content);
  assert.equal(h.get().busy, false);
  assert.equal(h.session.running, null);
  assert.equal(h.entrances.has(card.id), true);
  assert.equal(h.counts().flushed, 1);
  h.commitCard(card.id, '访谈计划', '人工补充：先约 5 位用户。');
  const edited = h.replies()[0];
  assert.equal(edited.data.title, '访谈计划');
  assert.equal(edited.data.content, '人工补充：先约 5 位用户。');
  assert.equal(h.get().workspace.messages[0].text, '# 核心问题\n先访谈，再验证重复录入的频率。');
});

test('duplicate completion events and repeated manual additions reuse the existing reply card', () => {
  const h = harness();
  h.event('text-delta', { delta: '## 结论\n保留完整回复。' });
  h.event('run-settled');
  assert.equal(h.replies().length, 0);
  h.replyToCanvas(h.run.messageId);
  const [card] = h.replies(), before = h.counts();
  h.event('run-settled');
  h.event('text-delta', { delta: '迟到的碎片' });
  h.replyToCanvas(h.run.messageId);
  h.replyToCanvas(h.run.messageId);
  assert.equal(h.replies().length, 1);
  assert.equal(h.replies()[0].id, card.id);
  assert.equal(h.replies()[0].data.content, '## 结论\n保留完整回复。');
  assert.deepEqual(h.focused, [card.id, card.id]);
  assert.deepEqual(h.counts(), before, 'reusing a reply cannot create another edit or flush');
});

test('short replies stay in the conversation until placed on the board by hand', () => {
  const h = harness();
  h.event('text-delta', { delta: '好的，**先约 5 位用户**再定方案。\n第二行补充。' });
  h.event('run-settled');
  assert.equal(h.replies().length, 0);
  h.replyToCanvas(h.run.messageId);
  assert.equal(h.replies().length, 1);
  assert.equal(h.replies()[0].data.title, '好的，先约 5 位用户再定方案。');
});

test('cancelled, failed and empty replies do not automatically add a document', () => {
  for (const settled of [{ cancelled: true }, { error: '本地模拟认证失败' }, {}]) {
    const h = harness();
    if (settled.cancelled || settled.error) h.event('text-delta', { delta: '尚未完成的回复。' });
    h.event('run-settled', settled);
    assert.equal(h.replies().length, 0);
    assert.equal(h.get().workspace.nodes.length, 1);
    assert.equal(h.get().workspace.messages[0].cancelled, !!settled.cancelled);
    assert.equal(h.get().workspace.messages[0].error, settled.error);
    assert.equal(h.get().busy, false);
    assert.equal(h.session.running, null);
  }
});

test('events for another workspace or run cannot change the active reply or add a card', () => {
  for (const foreign of [{ workspaceId: 'workspace-B' }, { runId: 'stale-run' }]) {
    const h = harness();
    for (const name of ['run-started', 'text-delta', 'context-info', 'run-settled']) {
      h.event(name, { ...foreign, delta: '其他会话的内容', contextNote: '不应附加', error: '不应结算' });
    }
    assert.equal(h.get().workspace.messages[0].text, '');
    assert.equal(h.get().workspace.messages[0].contextNote, undefined);
    assert.equal(h.get().workspace.messages[0].error, undefined);
    assert.equal(h.get().busy, true);
    assert.equal(h.session.running, h.run);
    assert.equal(h.run.runId, 'run-A');
    assert.equal(h.replies().length, 0);
    assert.deepEqual(h.counts(), { recorded: 0, flushed: 0 });
  }
  const h = harness();
  h.set({ workspace: { ...h.get().workspace, id: 'workspace-B' } });
  h.event('text-delta', { delta: '原会话的迟到回复' });
  h.event('run-settled');
  assert.equal(h.get().workspace.messages[0].text, '');
  assert.equal(h.replies().length, 0);
  assert.equal(h.counts().flushed, 0);
});


test('long replies and obsolete demo proposals never populate the board automatically', () => {
  const h = harness();
  const reply = '产品分析。'.repeat(100);
  h.event('text-delta', { delta: reply });
  h.event('cards-proposed', { cards: [{ title: '旧演示卡片', content: '不应创建' }] });
  h.event('run-settled');
  assert.equal(h.get().workspace.nodes.length, 1);
  assert.equal(h.get().workspace.messages[0].text, reply);
  assert.equal(h.counts().recorded, 0);
});

test('a user message can be placed manually once, with its full text and user ownership', () => {
  const h = harness();
  const text = '我想做一个访谈整理工具。\n先面向独立产品经理。';
  h.set({ workspace: { ...h.get().workspace, messages: [{ id: 'question', role: 'user', text }] } });
  h.replyToCanvas('question');
  const [card] = h.replies();
  assert.equal(card.data.content, text);
  assert.equal(card.data.source, 'user');
  assert.equal(card.data.kind, 'document');
  assert.equal(card.data.title, '我想做一个访谈整理工具。');
  h.replyToCanvas('question');
  assert.equal(h.replies().length, 1);
  assert.deepEqual(h.focused, [card.id]);
  assert.equal(h.counts().recorded, 1);
});

test('manual placement rejects empty and cancelled messages', () => {
  const h = harness();
  for (const message of [{ text: '' }, { text: '部分回复', cancelled: true }]) {
    h.set({ workspace: { ...h.get().workspace, messages: [{ id: 'blocked', role: 'assistant', ...message }] } });
    h.replyToCanvas('blocked');
    assert.equal(h.replies().length, 0);
  }
});

test('an error message copies and places only its visible Chinese content once', async () => {
  const h = harness();
  const error = 'HTTP 503: {"code":"model_not_found","api_key":"fixture-private-key","request_id":"fixture-request"}';
  const message = { id: 'failure', role: 'assistant', text: '', error };
  h.set({ workspace: { ...h.get().workspace, messages: [message] } });
  await h.copyMessage('failure');
  h.replyToCanvas('failure');
  const [card] = h.replies();
  assert.equal(card.data.content, h.copied[0]);
  assert.match(card.data.content, /当前模型暂时不可用/);
  assert.doesNotMatch(card.data.content, /HTTP|503|model_not_found|fixture-private-key|fixture-request/);
  assert.equal(card.data.source, 'ai');
  h.replyToCanvas('failure');
  assert.equal(h.replies().length, 1);
  assert.deepEqual(h.focused, [card.id]);
  assert.equal(h.counts().recorded, 1);
});

test('partial reply and visible error remain together when copied or placed', async () => {
  const h = harness();
  h.set({ workspace: { ...h.get().workspace, messages: [{ id: 'partial', role: 'assistant', text: '已经完成的分析。', error: 'HTTP 503 unavailable' }] } });
  await h.copyMessage('partial'); h.replyToCanvas('partial');
  const content = h.replies()[0].data.content;
  assert.equal(content, h.copied[0]);
  assert.match(content, /^已经完成的分析。\n\n模型服务暂时不可用/);
  assert.doesNotMatch(content, /HTTP|503|unavailable/);
});
