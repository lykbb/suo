import test from 'node:test';
import { linkedContext } from '../src/cardLinks.ts';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { hideSystemRecord } from '../src/messageError.mjs';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { replyWithSources } from '../src/sourceLinks.ts';

const source = await readFile(new URL('../src/actions.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('actions.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
const names = new Set(['hydrateDraftAttachments', 'serialize', 'scheduleSave', 'update', 'flush', 'startWith', 'updateDraft', 'canTravelDraft', 'travelDraftHistory', 'removeAttachment', 'importTarget', 'beginImport', 'endImport', 'beginNativeImport', 'importNativeAssets', 'importAssets', 'importBrowserFiles', 'switchSession', 'loadInitial', 'newCard', 'shortTitle', 'landAttachments', 'send', 'retry', 'continueMessage', 'actionLog', 'copyMessage', 'endSteps', 'receive', 'answer']);
const declarations = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text));
assert.equal(declarations.length, names.size);
const code = ts.transpileModule(declarations.map(node => node.getText(ast)).join('\n'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const clone = value => structuredClone(value);
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
const workspace = id => ({ id, title: '新会话', version: 1, updatedAt: '2026-10-11', nodes: [], edges: [], messages: [], draft: '', draftAttachments: [], panels: {}, viewport: { x: 0, y: 0, zoom: 1 } });
const asset = (id, kind = 'text') => ({ id, name: id + '.txt', kind, size: 40, mime: 'text/plain', text: '原件内容 ' + id });

function harness({ a = workspace('A'), b = workspace('B'), prepare, browser, save, load, ui } = {}) {
  const stored = new Map([['A', clone(a)], ['B', clone(b)]]), assets = new Map(), calls = [], notices = [], copies = [];
  let state = { workspace: clone(a), attachments: clone(a.draftAttachments ?? []), busy: false, sessionManaging: false, stage: { width: 1200, height: 750 }, historyVersion: 0, saveStatus: '已保存' };
  const session = { version: a.version, dirty: false, saving: null, pendingSave: null, pendingChanged: false, importing: false, importCount: 0, running: null };
  const apply = patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; };
  const context = {
    exports: {}, crypto: { randomUUID }, structuredClone, AbortController, Error, Set, Map, Math, session, hideSystemRecord, linkedContext,
    workspaceLoads: { revision: 0 }, draftHistory: new Map(), importJobs: new Map(), nativeImports: [],
    history: { past: [], future: [] }, saveTimer: null, bindings: { flow: null }, entrances: new Map(), STAGGER: 0.06,
    clearTimeout() {}, setTimeout() { return 1; }, requestAnimationFrame() { return 1; }, drainNodeChanges() {},
    cleanNodes: nodes => clone(nodes), withDrawingCard: value => value, record() {}, stop: async () => {}, focusComposer() {},
    center: () => ({ x: 250, y: 200 }), freeSpot: (_nodes, point) => point, boardViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    document: { querySelector: () => null }, flightFrom: () => undefined, LOCAL_COMMANDS: {}, replyWithSources,
    app: { get: () => state, set: apply }, notice: text => notices.push(text),
    navigator: { clipboard: { writeText: async text => copies.push(text) } }, messageDisplayText: message => message?.text ?? '',
    prepareMaterial: prepare ?? (async card => ({ title: card.title, content: card.content || card.asset?.text || '' })),
    prepareHistory: history => ({ history, summary: '', summarized: 0 }),
    browserFiles: browser ?? (async files => files), showQuestion() { return { shown: true }; }, handleUiRequest: ui ?? (async () => ({ done: true })),
    request: async (method, payload = {}) => {
      calls.push({ method, payload: clone(payload) });
      if (method === 'workspace.list') return [...stored.values()].map(clone);
      if (method === 'workspace.create') { const created = workspace('C'); stored.set(created.id, clone(created)); return created; }
      if (method === 'workspace.load') return load ? load(payload, stored) : clone(stored.get(payload.id) ?? null);
      if (method === 'asset.get') { if (!assets.has(payload.id)) throw new Error('原件缺失'); return clone(assets.get(payload.id)); }
      if (method === 'workspace.save') {
        if (save) return save(payload, stored);
        const old = stored.get(payload.state.id);
        if (old.saveReceipt?.id === payload.requestId && old.saveReceipt.baseVersion === payload.expectedVersion) return clone(old);
        if (old.version !== payload.expectedVersion) throw new Error('版本冲突');
        const next = { ...clone(payload.state), version: old.version + 1, saveReceipt: { id: payload.requestId, baseVersion: payload.expectedVersion } };
        stored.set(next.id, next); return clone(next);
      }
      if (method === 'prompt.send') return { runId: payload.runId };
      if (method === 'ui.reply') return {};
      throw new Error('Unexpected fixture method: ' + method);
    },
  };
  vm.runInNewContext(code, context);
  return { ...context.exports, get: () => state, set: apply, session, assets, stored, calls, notices, copies, context };
}

test('keystrokes during target loading persist to the visible source before switching', async () => {
  const wait = deferred(), h = harness({ load: payload => payload.id === 'B' ? wait.promise : workspace(payload.id) });
  const switching = h.switchSession('B'); await tick();
  h.updateDraft('加载期间继续写的内容');
  wait.resolve(workspace('B')); await switching;
  assert.equal(h.get().workspace.id, 'B'); assert.equal(h.stored.get('A').draft, '加载期间继续写的内容');
  assert.equal(h.calls.filter(call => call.method === 'workspace.save').at(-1).payload.state.id, 'A');
});

test('a failed save after target loading retains the visible source and its new draft', async () => {
  const wait = deferred(), h = harness({ load: () => wait.promise, save: async () => { throw new Error('断连'); } });
  const switching = h.switchSession('B'); await tick(); h.updateDraft('不会消失'); wait.resolve(workspace('B')); await switching;
  assert.equal(h.get().workspace.id, 'A'); assert.equal(h.get().workspace.draft, '不会消失'); assert.equal(h.session.dirty, true);
});

test('a skill prefixes an existing draft, with independent undo and redo across session changes', async () => {
  const a = { ...workspace('A'), draft: '原始问题' }, h = harness({ a });
  h.startWith('用调研技能帮我：'); assert.equal(h.get().workspace.draft, '用调研技能帮我：\n\n原始问题');
  h.travelDraftHistory(false); assert.equal(h.get().workspace.draft, '原始问题');
  h.travelDraftHistory(true); assert.equal(h.get().workspace.draft, '用调研技能帮我：\n\n原始问题');
  await h.switchSession('B'); assert.equal(h.canTravelDraft(false), false);
  await h.switchSession('A'); h.travelDraftHistory(false); assert.equal(h.get().workspace.draft, '原始问题');
});

test('a missing old attachment field loads compatibly and staged files persist by reference', async () => {
  const a = workspace('A'); delete a.draftAttachments; const h = harness({ a });
  await h.importAssets([asset('first'), asset('second')]); await h.flush();
  assert.equal(h.get().attachments.length, 2); const saved = h.stored.get('A'); assert.equal(saved.draftAttachments.length, 2);
  assert.equal(saved.draftAttachments[0].text, undefined); assert.equal(saved.draftAttachments[0].sourceUrl, undefined);
  for (const item of h.get().attachments) h.assets.set(item.id, item);
  await h.switchSession('B'); assert.equal(h.get().attachments.length, 0);
  await h.switchSession('A'); assert.equal(h.get().attachments[0].text, '原件内容 first');
  h.removeAttachment('first'); await h.flush(); assert.deepEqual(h.stored.get('A').draftAttachments.map(item => item.id), ['second']);
});

test('a restarted frontend hydrates the saved draft and attachment bytes', async () => {
  const a = { ...workspace('A'), draft: '未发送正文', draftAttachments: [{ ...asset('photo', 'image'), text: undefined }] };
  const h = harness({ a }); h.set({ workspace: null, attachments: [] }); h.assets.set('photo', { ...asset('photo', 'image'), base64: 'fixture-image' });
  await h.loadInitial(() => false); assert.equal(h.get().workspace.draft, '未发送正文'); assert.equal(h.get().attachments[0].base64, 'fixture-image');
});

test('a missing persisted original stays attached with an explicit unreadable reason', async () => {
  const b = { ...workspace('B'), draftAttachments: [asset('missing')] }, h = harness({ b });
  await h.switchSession('B'); assert.equal(h.get().attachments[0].id, 'missing'); assert.match(h.get().attachments[0].error, /原件暂时无法读取/u);
});

test('two overlapping imports keep switching blocked until the last batch settles', async () => {
  const one = deferred(), two = deferred(), h = harness({ browser: files => files[0] === 'one' ? one.promise : two.promise });
  const first = h.importBrowserFiles(['one']), second = h.importBrowserFiles(['two']); assert.equal(h.session.importCount, 2);
  one.resolve([asset('one')]); await first; assert.equal(h.session.importing, true); assert.equal(h.session.importCount, 1);
  await h.switchSession('B'); assert.equal(h.get().workspace.id, 'A');
  two.resolve([asset('two')]); await second; assert.equal(h.session.importing, false);
  assert.deepEqual(Array.from(h.get().attachments, item => item.id), ['one', 'two']); await h.flush(); assert.equal(h.stored.get('A').draftAttachments.length, 2);
});

test('an import started during a session-load wait prevents that pending switch from completing', async () => {
  const target = deferred(), files = deferred(), h = harness({ load: () => target.promise, browser: () => files.promise });
  const switching = h.switchSession('B'); await tick(); const importing = h.importBrowserFiles(['pending']);
  target.resolve(workspace('B')); await switching; assert.equal(h.get().workspace.id, 'A');
  files.resolve([asset('bound')]); await importing; assert.equal(h.get().attachments[0].id, 'bound');
});

test('captured import ownership never adds files to a later active workspace', async () => {
  const files = deferred(), h = harness({ browser: () => files.promise }); const importing = h.importBrowserFiles(['fixture']);
  h.set({ workspace: workspace('B'), attachments: [] }); h.session.version = 1;
  files.resolve([asset('belongs-to-A')]); await importing;
  assert.equal(h.get().workspace.id, 'B'); assert.equal(h.get().attachments.length, 0); assert.equal(h.stored.get('A').draftAttachments[0].id, 'belongs-to-A');
});

test('native import counters are independent from a model bridge error and settle in full', async () => {
  const h = harness(); h.beginNativeImport(); h.beginNativeImport(); h.receive({ event: 'bridge-error', data: { message: '模型连接断开' } });
  assert.equal(h.session.importing, true); await h.importNativeAssets([asset('native-1')]); assert.equal(h.session.importing, true);
  await h.importNativeAssets([asset('native-2')]); assert.equal(h.session.importing, false); assert.equal(h.get().attachments.length, 2);
});

test('a save with a lost acknowledgement retries an identical frozen request then saves later edits', async () => {
  let lost = true;
  const h = harness({ save: async (payload, stored) => {
    const old = stored.get(payload.state.id);
    if (old.saveReceipt?.id === payload.requestId) return clone(old);
    if (old.version !== payload.expectedVersion) throw new Error('版本冲突');
    const next = { ...clone(payload.state), version: old.version + 1, saveReceipt: { id: payload.requestId, baseVersion: payload.expectedVersion } }; stored.set(next.id, next);
    if (lost) { lost = false; throw new Error('确认丢失'); } return clone(next);
  } });
  h.updateDraft('第一次正文'); await h.flush(); const frozen = clone(h.session.pendingSave); h.updateDraft('后续新增正文'); await h.flush();
  const saves = h.calls.filter(call => call.method === 'workspace.save'); assert.equal(saves.length, 3);
  assert.deepEqual(saves[1].payload, frozen); assert.equal(saves[2].payload.expectedVersion, 2); assert.notEqual(saves[2].payload.requestId, frozen.requestId);
  assert.equal(h.stored.get('A').draft, '后续新增正文'); assert.equal(h.session.version, 3); assert.equal(h.session.pendingSave, null); assert.equal(h.session.dirty, false);
});

test('retrying an unchanged frozen save does not create a redundant revision', async () => {
  let failed = true; const h = harness({ save: async (payload, stored) => {
    const old = stored.get(payload.state.id); if (old.saveReceipt?.id === payload.requestId) return clone(old);
    const next = { ...clone(payload.state), version: old.version + 1, saveReceipt: { id: payload.requestId, baseVersion: payload.expectedVersion } }; stored.set(next.id, next);
    if (failed) { failed = false; throw new Error('断连'); } return clone(next);
  } });
  h.updateDraft('相同正文'); await h.flush(); await h.flush(); assert.equal(h.stored.get('A').version, 2); assert.equal(h.calls.filter(call => call.method === 'workspace.save').length, 2);
});

test('an unreadable selected asset stays on the board while ordinary text reaches the model', async () => {
  const bad = asset('unsupported', 'binary'), a = workspace('A'); a.nodes = [{ id: 'card', type: 'card', position: { x: 0, y: 0 }, selected: true, data: { kind: 'file', title: '坏资料', content: '', asset: bad } }];
  const h = harness({ a, prepare: async () => { throw new Error('暂不支持内容分析'); } }); await h.send('不分析附件，先讨论我的问题');
  const payload = h.calls.find(call => call.method === 'prompt.send').payload; assert.equal(payload.message, '不分析附件，先讨论我的问题');
  assert.match(payload.selected[0].content, /本轮未分析/u); assert.equal(payload.materialCatalog.prepared, 0); assert.equal(h.get().workspace.nodes[0].data.asset.id, bad.id);
  assert.equal(h.get().workspace.messages.at(-1).error, undefined); assert.match(h.get().workspace.messages.at(-1).contextNote, /未分析/u);
});

test('first-turn body limits preserve all material catalog references and board originals', async () => {
  const a = workspace('A'); a.nodes = Array.from({ length: 101 }, (_, i) => ({ id: 'card-' + i, selected: true, data: { kind: 'document', title: '资料' + i, content: '内容' + i } }));
  const h = harness({ a }); await h.send('整理资料'); const payload = h.calls.find(call => call.method === 'prompt.send').payload;
  assert.equal(payload.selected.length, 20); assert.equal(payload.materialCatalog.items.length, 80); assert.equal(payload.materialCatalog.total, 101); assert.equal(payload.materialCatalog.prepared, 20); assert.equal(payload.materialCatalog.next, 80);
  assert.equal(h.get().workspace.messages[0].cardIds.length, 101); assert.equal(h.get().workspace.nodes.length, 101);
});

test('retry retains original output, steps, receipts, cards, draft and attachment ownership', async () => {
  const a = workspace('A'), receipt = { operationId: 'logical:board.write:0', logicalRequestId: 'logical', kind: 'board.write', input: { title: '成果' }, inputHash: 'fixture', result: { ids: ['result'] } };
  a.draft = '后来写的草稿'; a.draftAttachments = [asset('later')]; a.nodes = [{ id: 'result', selected: false, data: { kind: 'note', title: '已完成成果', content: '不能删除' } }];
  a.messages = [{ id: 'question', role: 'user', text: '创建便签', logicalRequestId: 'logical', cardIds: ['result'] }, { id: 'failed', role: 'assistant', text: '已完成第一步', error: '网络断开', logicalRequestId: 'logical', steps: [{ id: 'step', label: '创建便签', status: 'done' }], operationReceipts: [receipt] }];
  const h = harness({ a }); await h.retry('failed'); const payload = h.calls.find(call => call.method === 'prompt.send').payload;
  assert.equal(h.get().workspace.messages.length, 3); assert.equal(h.get().workspace.messages[1].text, '已完成第一步'); assert.equal(h.get().workspace.messages[1].steps[0].status, 'done');
  assert.equal(h.get().workspace.messages[2].retryOf, 'failed'); assert.equal(payload.logicalRequestId, 'logical'); assert.equal(payload.operationReceipts[0].operationId, receipt.operationId);
  assert.equal(payload.retryContext.text, '已完成第一步'); assert.equal(h.get().workspace.nodes.length, 1); assert.equal(h.get().workspace.draft, '后来写的草稿'); assert.equal(h.get().attachments[0].id, 'later');
  h.session.running = null; h.set({ busy: false }); h.update(state => ({ ...state, messages: state.messages.map(item => item.id === state.messages.at(-1).id ? { ...item, error: '仍未完成' } : item) }));
  await h.retry(h.get().workspace.messages.at(-1).id); assert.equal(h.get().workspace.messages.length, 4); assert.equal(h.calls.filter(call => call.method === 'prompt.send').at(-1).payload.logicalRequestId, 'logical');
});

test('a retry conflict pauses future retries and length completion uses a separate continuation', async () => {
  const a = workspace('A'); a.draft = '暂存草稿'; a.draftAttachments = [asset('saved')]; a.messages = [{ id: 'user', role: 'user', text: '任务' }, { id: 'assistant', role: 'assistant', text: '部分输出', error: '达到长度上限', incomplete: true }];
  const h = harness({ a }); await h.retry('assistant'); assert.equal(h.calls.length, 0); await h.continueMessage('assistant');
  assert.equal(h.get().workspace.messages.length, 4); assert.equal(h.get().workspace.messages[1].text, '部分输出'); assert.equal(h.get().workspace.draft, '暂存草稿'); assert.equal(h.get().attachments[0].id, 'saved');
  const partial = h.calls.find(call => call.method === 'prompt.send').payload.history.find(item => item.role === 'assistant'); assert.equal(partial.text, '部分输出'); assert.equal(partial.error, false);
  h.session.running = { workspaceId: 'A', messageId: h.get().workspace.messages.at(-1).id, runId: 'run' }; h.receive({ event: 'run-settled', data: { workspaceId: 'A', runId: 'run', retryConflict: true, error: '重试暂停' } });
  const count = h.calls.length; await h.retry(h.get().workspace.messages.at(-1).id); assert.equal(h.calls.length, count); assert.equal(h.get().workspace.messages.at(-1).retryConflict, true);
});

test('assistant copy includes safe deduplicated tool sources while user text stays unchanged', async () => {
  const a = workspace('A'); a.messages = [{ id: 'user', role: 'user', text: '我的问题', steps: [{ refs: ['https://example.test/user'] }] }, { id: 'assistant', role: 'assistant', text: '结论', steps: [{ refs: ['官网 · https://example.test/source', 'javascript:alert(1)'] }] }];
  const h = harness({ a }); await h.copyMessage('user'); await h.copyMessage('assistant'); assert.equal(h.copies[0], '我的问题'); assert.match(h.copies[1], /https:\/\/example.test\/source/u); assert.doesNotMatch(h.copies[1], /javascript:/u);
});

test('a side-effect tool result is sent only after its saved receipt is confirmed', async () => {
  const h = harness(); h.updateDraft('保存状态'); await h.context.answer('ui', 'board.write', {}, { logicalRequestId: 'logical', operationId: 'logical:board.write:0', messageId: 'assistant' });
  assert.deepEqual(h.calls.map(call => call.method), ['workspace.save', 'ui.reply']); assert.equal(h.calls.at(-1).payload.error, undefined);
});

test('an unconfirmed side effect pauses the model and prevents another send until save recovery', async () => {
  let failed = true; const h = harness({ save: async (payload, stored) => {
    if (failed) throw new Error('保存失败'); const old = stored.get(payload.state.id), next = { ...clone(payload.state), version: old.version + 1 }; stored.set(next.id, next); return clone(next);
  } });
  h.updateDraft('待确认'); await h.context.answer('ui', 'board.write', {}, { operationId: 'logical:board.write:0' });
  assert.match(h.calls.at(-1).payload.error, /^\[SAVE_UNCONFIRMED\]/u); await h.send('后续任务'); assert.equal(h.calls.some(call => call.method === 'prompt.send'), false);
  failed = false; await h.send('后续任务'); assert.equal(h.calls.at(-1).method, 'prompt.send'); assert.equal(h.session.pendingSave, null);
});

test('a retry waits for pending save confirmation and keeps the original history while blocked', async () => {
  const a = workspace('A'); a.messages = [{ id: 'user', role: 'user', text: '创建卡片', logicalRequestId: 'logical' }, { id: 'assistant', role: 'assistant', text: '已创建', logicalRequestId: 'logical', error: '保存失败', saveUnconfirmed: true }];
  const h = harness({ a, save: async () => { throw new Error('仍未确认'); } }); h.updateDraft('待保存'); await h.flush(); await h.retry('assistant');
  assert.equal(h.get().workspace.messages.length, 2); assert.equal(h.get().workspace.messages[1].text, '已创建'); assert.equal(h.calls.some(call => call.method === 'prompt.send'), false);
});

test('board-task classification permissions persist in the user message and bridge payload without consuming the draft', async () => {
  for (const allowRegroup of [false, true]) {
    const a = workspace('A'); a.draft = '普通草稿'; a.draftAttachments = [asset('unsubmitted')];
    const h = harness({ a }), boardTask = { mode: 'classify', allowRegroup };
    await h.send('归类现有卡片', { land: false, preserveDraft: true, boardTask });
    const payload = h.calls.find(call => call.method === 'prompt.send').payload;
    assert.deepEqual(payload.boardTask, boardTask); assert.deepEqual(clone(h.get().workspace.messages[0].boardTask), boardTask);
    assert.equal(h.get().workspace.draft, '普通草稿'); assert.equal(h.get().attachments[0].id, 'unsubmitted'); assert.equal(h.get().workspace.nodes.length, 0);
    await h.flush(); assert.deepEqual(clone(h.stored.get('A').messages[0].boardTask), boardTask);
  }
});

test('board-task retry and continuation inherit original classification scope across saved messages', async () => {
  for (const allowRegroup of [false, true]) {
    const a = workspace('A'), boardTask = { mode: 'classify', allowRegroup };
    a.messages = [{ id: 'user', role: 'user', text: '智能归类', logicalRequestId: 'logical', boardTask }, { id: 'assistant', role: 'assistant', text: '已有成果', logicalRequestId: 'logical', error: '网络断开' }];
    const h = harness({ a }); await h.retry('assistant');
    assert.deepEqual(h.calls.find(call => call.method === 'prompt.send').payload.boardTask, boardTask); assert.equal(h.get().workspace.messages.length, 3);
    const last = h.get().workspace.messages.at(-1); h.session.running = null; h.set({ busy: false }); h.update(state => ({ ...state, messages: state.messages.map(item => item.id === last.id ? { ...item, incomplete: true } : item) }));
    await h.continueMessage(last.id); const payload = h.calls.filter(call => call.method === 'prompt.send').at(-1).payload;
    assert.deepEqual(payload.boardTask, boardTask); assert.deepEqual(clone(h.get().workspace.messages.at(-2).boardTask), boardTask);
  }
});

test('board-task fields are absent from ordinary conversations and legacy retry requests', async () => {
  const h = harness(); await h.send('普通聊天'); assert.equal(Object.hasOwn(h.calls.at(-1).payload, 'boardTask'), false); assert.equal(Object.hasOwn(h.get().workspace.messages[0], 'boardTask'), false);
  const a = workspace('A'); a.messages = [{ id: 'user', role: 'user', text: '旧会话问题' }, { id: 'assistant', role: 'assistant', text: '旧输出', error: '失败' }];
  const legacy = harness({ a }); await legacy.retry('assistant'); assert.equal(Object.hasOwn(legacy.calls.at(-1).payload, 'boardTask'), false); assert.equal(legacy.get().workspace.messages[0].boardTask, undefined);
});
