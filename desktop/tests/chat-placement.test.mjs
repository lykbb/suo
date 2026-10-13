import test from 'node:test';
import { linkedContext } from '../src/cardLinks.ts';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { hideSystemRecord } from '../src/messageError.mjs';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../src/actions.ts', import.meta.url), 'utf8');
const syntax = ts.createSourceFile('actions.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
const names = new Set(['newCard', 'shortTitle', 'landAttachments', 'send', 'actionLog']);
const declarations = syntax.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text));
assert.equal(declarations.length, names.size);
const code = ts.transpileModule(declarations.map(node => node.getText(syntax)).join('\n'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness({ nodes = [], attachments = [] } = {}) {
  let state = { busy: false, attachments, stage: { width: 1280, height: 668 },
    workspace: { id: 'local-fixture', title: '新会话', nodes, edges: [], messages: [], draft: '', panels: {} } };
  const calls = [], entrances = new Map(), session = { running: null };
  let recorded = 0;
  const context = {
    exports: {}, crypto: { randomUUID }, AbortController, setTimeout, clearTimeout, session, entrances, STAGGER: 0.06, hideSystemRecord, linkedContext,
    app: { get: () => state, set: patch => { state = { ...state, ...patch }; } },
    update: change => { state = { ...state, workspace: change(state.workspace) }; },
    record: () => { recorded++; }, flush: async () => {}, notice: () => {}, LOCAL_COMMANDS: {},
    center: () => ({ x: 450, y: 260 }), freeSpot: (_nodes, point) => point,
    boardViewport: () => ({ x: 0, y: 0, zoom: 1 }), bindings: { flow: null },
    document: { querySelector: () => null }, flightFrom: () => undefined,
    prepareMaterial: async card => ({ title: card.title, content: card.content || card.asset?.text || '' }),
    prepareHistory: history => ({ history, summary: '', summarized: 0 }),
    request: async (method, payload) => { calls.push({ method, payload }); return { runId: payload.runId }; },
  };
  vm.runInNewContext(code, context);
  return { ...context.exports, get: () => state, calls, recorded: () => recorded };
}

test('the first message opens the conversation without creating or referencing an idea card', async () => {
  const h = harness();
  await h.send('哈哈');
  assert.equal(h.get().workspace.nodes.length, 0);
  assert.equal(h.get().threadOpen, true);
  assert.equal(h.get().workspace.title, '哈哈');
  assert.equal(h.get().workspace.messages[0].text, '哈哈');
  assert.equal(h.get().workspace.messages[0].cardIds.length, 0);
  assert.equal(h.calls[0].method, 'prompt.send');
  assert.equal(h.calls[0].payload.message, '哈哈');
  assert.equal(h.calls[0].payload.selected.length, 0);
  assert.equal(h.recorded(), 0, 'conversation-only sends do not add a board undo step');
});

test('sending while cards are selected preserves the cards and references them without duplicating the question', async () => {
  const card = { id: 'existing', selected: true, type: 'card', position: { x: 10, y: 10 },
    data: { kind: 'document', title: '访谈', content: '用户反复复制资料' } };
  const h = harness({ nodes: [card] });
  await h.send('先讨论这个问题');
  assert.equal(h.get().workspace.nodes.length, 1);
  assert.equal(h.get().workspace.nodes[0], card);
  assert.equal(h.get().workspace.messages[0].cardIds[0], card.id);
  assert.equal(h.calls[0].payload.selected[0].content, card.data.content);
});

test('staged files remain material cards, including when an existing card is selected', async () => {
  const card = { id: 'existing', selected: true, type: 'card', position: { x: 10, y: 10 }, data: { kind: 'note', title: '问题', content: '需要访谈' } };
  const asset = { id: 'asset-fixture', name: '访谈.txt', kind: 'text', text: '访谈原文' };
  for (const nodes of [[], [card]]) {
    const h = harness({ nodes, attachments: [asset] });
    await h.send('分析附件');
    assert.equal(h.get().workspace.nodes.length, nodes.length + 1);
    const file = h.get().workspace.nodes.at(-1);
    assert.equal(file.data.kind, 'file');
    assert.equal(file.data.asset, asset);
    assert.equal(h.get().workspace.messages[0].cardIds.at(-1), file.id);
    assert.equal(h.calls[0].payload.selected.at(-1).content, asset.text);
    assert.equal(h.get().attachments.length, 0);
    assert.equal(h.recorded(), 1);
  }
});

test('a retry creates no extra cards and keeps the original material references', async () => {
  const card = { id: 'file', selected: true, type: 'card', position: { x: 10, y: 10 }, data: { kind: 'file', title: '访谈.txt', content: '原文' } };
  const h = harness({ nodes: [card] });
  await h.send('再分析一次', { land: false });
  assert.equal(h.get().workspace.nodes.length, 1);
  assert.equal(h.get().workspace.messages[0].cardIds[0], card.id);
  assert.equal(h.recorded(), 0);
});
