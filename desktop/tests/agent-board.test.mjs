import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import { freeSpot, nodeBoxes, ungroupCards } from '../src/geometry.ts';
import { CARD_COLORS, metadataPatch, readCardTags } from '../src/cardMetadata.ts';
import { arrangeBoardNodes, classifyBoardNodes } from '../src/boardLayout.ts';

// The real interface-side tool code, run against a plain session state.
const source = await readFile(new URL('../src/agentTools.ts', import.meta.url), 'utf8');
const syntax = ts.createSourceFile('agentTools.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
const code = ts.transpileModule(syntax.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(syntax)).join('\n'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const card = (id, extra = {}) => ({ id, type: 'card', position: { x: 0, y: 0 }, style: { width: 258, height: 174 }, data: { kind: 'note', title: id, content: `${id} 的内容`, source: 'user', ...extra } });
function harness(nodes = [], edges = [], editor = null, extra = {}) {
  let state = { workspace: { id: 'w', nodes, edges, messages: [] }, editor };
  const records = [], reveals = [];
  const context = {
    exports: {}, crypto: { randomUUID }, AbortSignal,
    app: { get: () => state, set: patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; } },
    update: change => { state = { ...state, workspace: change(state.workspace) }; },
    record: () => records.push(1), frameBoard: () => {}, animateIn: () => {}, reveal: (box, label) => reveals.push({ box, label }), center: () => ({ x: 0, y: 0 }),
    newCard: (data, x, y) => ({ id: randomUUID(), type: 'card', position: { x, y }, style: { width: 258 }, data: { title: '新便签', content: '', kind: 'note', source: 'user', ...data } }),
    freeSpot, nodeBoxes, ungroupCards, arrangeBoardNodes, classifyBoardNodes, CARD_COLORS, metadataPatch, readCardTags, readMaterial: async () => ({}), searchMaterials: async () => ({ hits: [] }), ...extra,
  };
  vm.runInNewContext(code, context);
  return { ...context.exports, get: () => state.workspace, records, reveals };
}
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('cards are placed as a group with links, beside existing work, as one undo step', async () => {
  const existing = card('11111111-user-card');
  const h = harness([existing]);
  const result = await h.handleUiRequest('board.write', { group: '需求拆解', cards: [{ key: 'p', title: '问题', content: '重复录入' }, { key: 'u', title: '用户', content: '运营' }, { title: '假设', content: '每周 3 次以上' }],
    links: [{ from: 'u', to: 'p', label: '遇到' }, { from: 'u', to: 'nowhere1' }] });
  const { nodes, edges } = h.get(), group = nodes.find(node => node.data.kind === 'group');
  assert.equal(result.created.length, 3); assert.equal(result.links, 1); assert.equal(result.skippedLinks, 1);
  assert.equal(group.data.title, '需求拆解'); assert.equal(nodes.indexOf(group) < nodes.findIndex(node => node.parentId === group.id), true, 'a group comes before its cards');
  assert.equal(nodes.filter(node => node.parentId === group.id).length, 3);
  assert(result.created.every(item => nodes.some(node => node.id.startsWith(item.id) && node.data.source === 'ai')));
  assert.equal(edges[0].label, '遇到');
  const [groupBox, userBox] = nodeBoxes([group, existing]);
  assert(!overlaps(groupBox, userBox), 'new cards do not cover the user\'s card');
  assert.equal(h.records.length, 1); assert.match(h.reveals[0].label, /整理了 3 张卡片/);
});

test('reading the board names cards by short ids and can list only the selection', async () => {
  const file = card('22222222-file', { kind: 'file', asset: { id: 'asset', kind: 'pdf', name: '访谈.pdf' }, title: '访谈.pdf' });
  const h = harness([card('11111111-note'), { ...file, selected: true }]);
  const all = await h.handleUiRequest('board.read', {});
  assert.deepEqual(all.cards.map(item => [item.id, item.kind, item.selected]), [['11111111-note', 'note', false], ['22222222-file', 'file', true]]);
  assert.equal(all.cards[1].fileKind, 'pdf'); assert.equal(all.cards[1].excerpt, '');
  assert.deepEqual((await h.handleUiRequest('board.read', { selectedOnly: true })).cards.map(item => item.id), ['22222222-file']);
});

test('Suo can edit and remove any card, but not a card the user is typing in or the text of a file', async () => {
  const mine = card('aaaaaaaa-ai', { source: 'ai' }), theirs = card('bbbbbbbb-user'), file = card('cccccccc-file', { asset: { id: 'x', kind: 'pdf' } }), open = card('dddddddd-open');
  const h = harness([mine, theirs, file, open], [{ id: 'e1', source: mine.id, target: theirs.id }], { id: open.id });
  const result = await h.handleUiRequest('board.edit', { changes: [
    { action: 'update', id: 'cccccccc', content: '改写' }, { action: 'update', id: 'cccccccc', title: '访谈录音' }, { action: 'update', id: 'dddddddd', content: '改写' },
    { action: 'remove', id: 'dddddddd' }, { action: 'update', id: 'bbbbbbbb', title: '新标题' }, { action: 'link', from: 'bbbbbbbb', to: 'dddddddd', label: '依赖' }, { action: 'remove', id: 'aaaaaaaa' },
  ] });
  assert.equal(result.done, 4); assert.equal(result.failed, 3);
  assert.match(result.summary, /资料卡片的内容不能修改/); assert.match(result.summary, /用户正在编辑/);
  const { nodes, edges } = h.get();
  assert.equal(nodes.some(node => node.id === mine.id), false); assert.equal(nodes.find(node => node.id === theirs.id).data.title, '新标题');
  assert.equal(nodes.find(node => node.id === file.id).data.title, '访谈录音');
  assert.equal(JSON.stringify(edges.map(item => [item.source, item.target, item.label])), JSON.stringify([[theirs.id, open.id, '依赖']]));
  const removed = await harness([theirs, file]).handleUiRequest('board.edit', { changes: [{ action: 'remove', id: 'bbbbbbbb' }, { action: 'remove', id: 'cccccccc' }] });
  assert.equal(removed.done, 2, 'the user\'s own cards and files can be removed when asked');
  assert.equal(h.records.length, 1);
});

test('colors, tags, pins, moves and sizes go through the same rules as the appearance panel', async () => {
  const a = card('aaaaaaaa'), b = { ...card('bbbbbbbb'), position: { x: 600, y: 0 } }, c = { ...card('cccccccc', { color: '#dbeafe' }), position: { x: 0, y: 600 } };
  const h = harness([a, b, c]);
  const result = await h.handleUiRequest('board.edit', { changes: [
    { action: 'style', ids: ['aaaaaaaa', 'bbbbbbbb'], color: '黄', tags: ['待验证', '待验证', 'P0'], pinned: true },
    { action: 'style', id: 'cccccccc', color: '默认' }, { action: 'style', id: 'bbbbbbbb', color: 'magenta' },
    { action: 'move', id: 'bbbbbbbb', near: 'aaaaaaaa', side: 'below' }, { action: 'resize', id: 'aaaaaaaa', width: 400, height: 50 },
  ] });
  assert.equal(result.done, 4); assert.match(result.summary, /不认识的颜色「magenta」.*浅黄/);
  const [na, nb, nc] = ['aaaaaaaa', 'bbbbbbbb', 'cccccccc'].map(id => h.get().nodes.find(node => node.id.startsWith(id)));
  assert.equal(na.data.color, '#fef3c7'); assert.equal(JSON.stringify(na.data.tags), JSON.stringify(['待验证', 'P0'])); assert.equal(na.data.pinned, true);
  assert.equal('color' in nc.data, false);
  assert.equal(nb.position.x, 0); assert(nb.position.y >= 174 + 24, 'moved below the other card');
  assert.equal(JSON.stringify(na.style), JSON.stringify({ width: 400, height: 80 }));
  const read = await h.handleUiRequest('board.read', {});
  const first = read.cards.find(item => item.id === 'aaaaaaaa');
  assert.equal(first.color, '浅黄'); assert.equal(JSON.stringify(first.box), JSON.stringify([0, 0, 400, 80]));
});

test('cards inside a group are arranged in place and the group fits around them; groups can be colored and taken apart', async () => {
  const a = card('aaaaaaaa'), b = { ...card('bbbbbbbb'), position: { x: 700, y: 300 } }, d = { ...card('dddddddd'), position: { x: 1400, y: 0 } };
  const h = harness([a, b, d]);
  await h.handleUiRequest('board.edit', { changes: [{ action: 'group', ids: ['aaaaaaaa', 'bbbbbbbb'], title: '用户', color: '浅绿' }] });
  const group = h.get().nodes.find(node => node.data.kind === 'group');
  assert.equal(group.data.color, '#dcfce7');
  await h.handleUiRequest('board.edit', { changes: [{ action: 'arrange', ids: ['aaaaaaaa', 'bbbbbbbb'], layout: 'row' }] });
  const inside = h.get().nodes.filter(node => node.parentId === group.id), fitted = h.get().nodes.find(node => node.id === group.id);
  assert.equal(inside[0].position.y, inside[1].position.y);
  assert(inside[1].position.x > inside[0].position.x + 258);
  assert(Number(fitted.style.width) >= Math.max(...inside.map(node => node.position.x + Number(node.style.width))));
  assert(Number(fitted.style.height) >= Math.max(...inside.map(node => node.position.y + Number(node.style.height))));
  const mixed = await h.handleUiRequest('board.edit', { changes: [{ action: 'arrange', ids: ['aaaaaaaa', 'dddddddd'] }] });
  assert.match(mixed.summary, /完成 1 项调整/);
  assert.equal(h.get().nodes.find(node => node.id === a.id).parentId, group.id);
  assert.equal(h.get().nodes.find(node => node.id === d.id).parentId, undefined);
  await h.handleUiRequest('board.edit', { changes: [{ action: 'ungroup', id: group.id.slice(0, 8) }] });
  assert.equal(h.get().nodes.some(node => node.data.kind === 'group' || node.parentId), false);
});

test('arranging, grouping and unlinking existing cards', async () => {
  const a = card('aaaaaaaa'), b = { ...card('bbbbbbbb'), position: { x: 900, y: 500 } };
  const h = harness([a, b], [{ id: 'e', source: a.id, target: b.id }]);
  await h.handleUiRequest('board.edit', { changes: [{ action: 'arrange', ids: ['aaaaaaaa', 'bbbbbbbb'], layout: 'row' }, { action: 'unlink', from: 'bbbbbbbb', to: 'aaaaaaaa' }, { action: 'group', ids: ['aaaaaaaa', 'bbbbbbbb'], title: '一组' }] });
  const { nodes, edges } = h.get();
  assert.equal(edges.length, 0);
  const group = nodes.find(node => node.data.kind === 'group'), [first, second] = nodeBoxes(nodes).filter((_, index) => nodes[index].parentId === group.id);
  assert.equal(first.y, second.y, 'a row keeps the cards level'); assert(second.x > first.x + first.width);
});

test('documents are created, or edited by chapter without touching the rest', async () => {
  const outline = '一、背景与问题\n\n二、目标用户\n\n三、关键取舍';
  const doc = card('eeeeeeee-doc', { kind: 'document', content: outline });
  const h = harness([doc]);
  const created = await h.handleUiRequest('document.write', { title: '访谈提纲', content: '# 访谈提纲\n\n1. 最近一次经历' });
  assert.equal(created.created, true); assert.equal(h.get().nodes.find(node => node.id.startsWith(created.id)).data.kind, 'document');
  await h.handleUiRequest('document.write', { id: 'eeeeeeee', mode: 'section', section: '目标用户', content: '独立产品经理，每周整理 3 份访谈。' });
  const text = h.get().nodes.find(node => node.id === doc.id).data.content;
  assert.match(text, /二、目标用户\n\n独立产品经理，每周整理 3 份访谈。\n\n三、关键取舍/);
  assert.match(text, /^一、背景与问题/);
  await h.handleUiRequest('document.write', { id: 'eeeeeeee', mode: 'section', section: '风险', content: '数据不足' });
  assert.match(h.get().nodes.find(node => node.id === doc.id).data.content, /## 风险\n\n数据不足\n$/);
  const busy = harness([doc], [], { id: doc.id });
  await assert.rejects(busy.handleUiRequest('document.write', { id: 'eeeeeeee', mode: 'replace', content: 'x' }), /正在编辑/);
});

test('Markdown sections end at the next heading of the same or a higher level', () => {
  const h = harness();
  const markdown = '# 报告\n## 问题\n旧内容\n### 细节\n旧细节\n## 方案\n保留';
  assert.equal(h.replaceSection(markdown, '## 问题', '新内容'), '# 报告\n## 问题\n\n新内容\n\n## 方案\n保留');
  assert.throws(() => h.replaceSection(markdown, '  ', 'x'), /指定要替换的章节/);
});

test('a search stopped by a verification page is tried once more on the other engine', async () => {
  const engines = [];
  const h = harness([], [], null, { browserSearch: async (query, engine) => { engines.push(engine); if (engine === 'baidu') throw new Error('搜索引擎要求人工验证'); return { engine: '必应', results: [] }; } });
  assert.equal((await h.handleUiRequest('web.search', { query: '访谈整理工具' })).engine, '必应');
  assert.deepEqual(engines, ['baidu', 'bing']);
  const tries = [];
  const invalid = harness([], [], null, { browserSearch: async () => { tries.push(1); throw new Error('请提供 200 字以内的搜索词。'); } });
  await assert.rejects(invalid.handleUiRequest('web.search', { query: 'x' }), /200 字/);
  assert.equal(tries.length, 1, 'a bad query is not retried');
});
