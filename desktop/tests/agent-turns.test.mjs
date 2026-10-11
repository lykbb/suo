import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

// The interface side of a turn: what the model is told about earlier replies, and answering a question.
const source = await readFile(new URL('../src/actions.ts', import.meta.url), 'utf8');
const syntax = ts.createSourceFile('actions.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
const names = new Set(['historyText', 'chooseOption', 'endSteps']);
const declarations = syntax.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text));
assert.equal(declarations.length, names.size);
const code = ts.transpileModule(declarations.map(node => node.getText(syntax)).join('\n'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function harness(messages, busy = false) {
  let state = { busy, workspace: { messages } };
  const sent = [];
  const context = { exports: {}, app: { get: () => state }, update: change => { state = { ...state, workspace: change(state.workspace) }; }, send: async (text, options) => { sent.push({ text, options }); } };
  vm.runInNewContext(code, context);
  return { ...context.exports, endSteps: context.endSteps, sent, get: () => state.workspace.messages };
}

test('earlier replies carry what that turn did, including the pages it found and the question it asked', () => {
  const { historyText } = harness([]);
  assert.equal(historyText({ role: 'assistant', text: '好的' }), '好的');
  const text = historyText({ role: 'assistant', text: '', steps: [
    { id: '1', label: '整理画布「需求拆解」', status: 'done', detail: '已放置 4 张卡片' },
    { id: '2', label: '联网搜索「访谈工具」', status: 'done', refs: ['工具 A https://a.example', '工具 B https://b.example'] },
    { id: '3', label: '读取网页 c.example', status: 'error', detail: '已停止' },
  ], ask: { question: '主要给谁用？', options: [{ label: '团队' }, { label: '个人' }] } });
  assert.match(text, /^〔系统记录：这一轮实际执行了〕/);
  assert.match(text, /整理画布「需求拆解」：已放置 4 张卡片/);
  assert.match(text, /· 工具 B https:\/\/b\.example/);
  assert.match(text, /读取网页 c\.example：已停止（未完成）/);
  assert.match(text, /向用户提问「主要给谁用？」，选项：团队 \/ 个人/);
});

test('an option is sent once, only from the latest question, and marked as chosen', async () => {
  const ask = { question: '主要给谁用？', options: [{ label: '团队' }, { label: '个人' }] };
  const h = harness([{ id: 'q', role: 'user', text: '做个工具' }, { id: 'a', role: 'assistant', text: '', ask }]);
  await h.chooseOption('a', '不存在');
  await h.chooseOption('a', '团队');
  await h.chooseOption('a', '个人');
  assert.deepEqual(h.sent.map(item => item.text), ['团队']);
  assert.equal(h.get().at(-1).ask.answered, '团队');
  const busy = harness([{ id: 'a', role: 'assistant', text: '', ask }], true);
  await busy.chooseOption('a', '团队');
  assert.equal(busy.sent.length, 0);
  const older = harness([{ id: 'a', role: 'assistant', text: '', ask }, { id: 'u', role: 'user', text: '我自己说吧' }]);
  await older.chooseOption('a', '团队');
  assert.equal(older.sent.length, 0);
});

test('stopping a reply also stops the spinner of a step that was still running', () => {
  const { endSteps } = harness([]);
  const message = { id: 'a', role: 'assistant', text: '', steps: [{ id: '1', label: '读取资料', status: 'running' }, { id: '2', label: '查看画布', status: 'done' }] };
  assert.deepEqual([...endSteps(message).steps].map(step => [step.status, step.detail]), [['error', '已停止'], ['done', undefined]]);
  const done = { id: 'b', role: 'assistant', text: 'x', steps: [{ id: '1', label: '查看画布', status: 'done' }] };
  assert.equal(endSteps(done), done);
});
