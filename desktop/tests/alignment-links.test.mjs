import test from 'node:test';
import assert from 'node:assert/strict';
import { alignTo } from '../src/alignment.ts';
import { facingSides, linkedContext, RELATIONS } from '../src/cardLinks.ts';
import { nodeBoxes } from '../src/geometry.ts';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

// alignSelected from actions.ts, run against a plain board.
const source = await readFile(new URL('../src/actions.ts', import.meta.url), 'utf8');
const syntax = ts.createSourceFile('actions.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
const alignCode = ts.transpileModule(syntax.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === 'alignSelected').map(node => node.getText(syntax)).join('\n'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function board(nodes) {
  let state = { workspace: { nodes } }; const notices = [], records = [];
  const context = { exports: {}, nodeBoxes, app: { get: () => state }, update: change => { state = { ...state, workspace: change(state.workspace) }; }, record: () => records.push(1), notice: text => notices.push(text) };
  vm.runInNewContext(alignCode, context);
  return { align: context.exports.alignSelected, get: () => state.workspace.nodes, notices, records };
}

const box = (x, y, width = 200, height = 100) => ({ x, y, width, height });

test('a dragged card settles onto the same kind of line nearby, never across kinds or from afar', () => {
  const other = box(100, 0);
  // 3 apart: settles; 12 apart: stays where it is.
  assert.equal(alignTo(box(103, 300), [other], 5).dx, -3);
  assert.equal(alignTo(box(112, 300), [other], 5).dx, 0);
  // A right edge next to a left edge is not an alignment.
  assert.equal(alignTo(box(302, 300), [other], 5).dx, 0);
  // Middles line up, and both directions at once.
  assert.equal(alignTo(box(97, 300, 208), [other], 5).dx, -1);
  const both = alignTo(box(104, 3), [other], 5);
  assert.deepEqual([both.dx, both.dy], [-4, -3]);
});

test('one guide per direction, following where the card is placed', () => {
  const other = box(100, 0);
  const shown = moving => alignTo(moving, [other], 5).guides.map(guide => `${guide.axis}@${guide.at}`);
  // A narrower card toward the left shows the left line, toward the right the right line, centred the middle.
  assert.deepEqual(shown(box(102, 300, 100)), ['x@100']);
  assert.deepEqual(shown(box(197, 300, 100)), ['x@300']);
  assert.deepEqual(shown(box(148, 300, 100)), ['x@200']);
  // Same size: all three line up, the middle line stands for that.
  assert.deepEqual(shown(box(102, 300)), ['x@200']);
  // The guide reaches every card on that line, and nothing shows without an alignment.
  const placed = alignTo(box(101, 300, 100), [box(100, 0), box(100, 150, 120)], 5);
  assert.deepEqual({ ...placed.guides[0] }, { axis: 'x', at: 100, from: 0, to: 400 });
  assert.equal(alignTo(box(500, 500), [other], 5).guides.length, 0);
});

test('asking about a card brings its linked cards and the relations along, not groups or drawings', () => {
  const card = (id, title, kind = 'note') => ({ id, type: 'card', position: { x: 0, y: 0 }, data: { kind, title, content: '' } });
  const nodes = [card('a', '访谈记录分散'), card('b', '整理耗时'), card('c', '自动转写'), card('g', '分组', 'group'), card('d', '草图', 'drawing'), card('x', '无关')];
  const edges = [
    { id: '1', source: 'a', target: 'b', label: '导致' }, { id: '2', source: 'c', target: 'a', label: ' ' },
    { id: '3', source: 'a', target: 'g' }, { id: '4', source: 'd', target: 'a' }, { id: '5', source: 'x', target: 'c' },
  ];
  const { related, relations } = linkedContext(nodes, edges, ['a']);
  assert.deepEqual(related.map(node => node.id), ['b', 'c']);
  assert.deepEqual(relations, ['「访谈记录分散」 → 「整理耗时」（导致）', '「自动转写」 → 「访谈记录分散」']);
  assert.equal(linkedContext(nodes, edges, []).related.length, 0);
  assert.equal(linkedContext(nodes, Array.from({ length: 12 }, (_, i) => ({ id: `e${i}`, source: 'a', target: `n${i}` })).concat([]), ['a'], 8).related.length, 0, 'links to missing cards are ignored');
  assert(RELATIONS.includes('导致') && RELATIONS.includes('验证'));
});

test('selected cards line up on one edge in one undo step, including cards inside a group', () => {
  const card = (id, x, y, width, extra = {}) => ({ id, type: 'card', position: { x, y }, style: { width, height: 100 }, selected: true, data: { kind: 'note', title: id, content: '' }, ...extra });
  const group = { id: 'g', type: 'group', position: { x: 500, y: 0 }, style: { width: 400, height: 300 }, data: { kind: 'group', title: '组', content: '' } };
  const h = board([card('a', 40, 0, 200), card('b', 10, 200, 300), group, card('c', 20, 50, 100, { parentId: 'g' })]);
  h.align('left');
  assert.deepEqual(h.get().filter(node => node.id !== 'g').map(node => node.position.x), [10, 10, 10 - 500]);
  h.align('right');
  assert.deepEqual(h.get().filter(node => node.id !== 'g').map(node => node.position.x), [110, 10, 310 - 100 - 500]);
  h.align('bottom');
  assert.deepEqual(h.get().filter(node => node.id !== 'g').map(node => node.position.y), [200, 200, 200]);
  assert.equal(h.records.length, 3);
  const single = board([card('a', 0, 0, 100), card('b', 50, 50, 100, { selected: false })]);
  single.align('top');
  assert.equal(single.notices.length, 1); assert.equal(single.records.length, 0);
});

test('selected cards can line up on the middle of their overall extent, across and down', () => {
  const card = (id, x, y, width) => ({ id, type: 'card', position: { x, y }, style: { width, height: 100 }, selected: true, data: { kind: 'note', title: id, content: '' } });
  const h = board([card('a', 0, 0, 100), card('b', 200, 300, 300)]);
  h.align('center');
  assert.deepEqual(h.get().map(node => node.position.x), [200, 100]);
  h.align('middle');
  assert.deepEqual(h.get().map(node => node.position.y), [150, 150]);
});

test('a connection runs between the facing sides, right to left as before, never looping', () => {
  const card = box(0, 0);
  const sides = target => { const { from, to } = facingSides(card, target); return `${from}→${to}`; };
  // Target to the right, even far below or above: the usual right-to-left line.
  assert.equal(sides(box(400, 20)), 'right→left');
  assert.equal(sides(box(260, 600)), 'right→left');
  // To the left: back across; stacked: down or up.
  assert.equal(sides(box(-400, 20)), 'left→right');
  assert.equal(sides(box(-300, 300)), 'left→right');
  assert.equal(sides(box(30, 300)), 'bottom→top');
  assert.equal(sides(box(-30, -300)), 'top→bottom');
});

test('lines meet at the middle of a side, where its dot is, however many come and go', () => {
  const card = box(0, 0), right = facingSides(card, box(400, 0)), below = facingSides(card, box(30, 300));
  assert.deepEqual([{ ...right.start }, { ...right.end }], [{ x: 200, y: 50 }, { x: 400, y: 50 }]);
  assert.deepEqual([{ ...below.start }, { ...below.end }], [{ x: 100, y: 100 }, { x: 130, y: 300 }]);
  // Out to two cards on the right and in from one: all on the same dot.
  const outs = [box(400, -200), box(400, 300)].map(target => facingSides(card, target).start);
  const into = facingSides(box(500, 100), card).end;
  for (const point of [...outs, into]) assert.deepEqual({ ...point }, { x: 200, y: 50 });
  // A line back the other way takes the same route, so a two-way link is one line.
  for (const other of [box(400, 20), box(260, 600), box(30, 300), box(-30, -300), box(-400, 20)]) {
    const there = facingSides(card, other), back = facingSides(other, card);
    assert.deepEqual([{ ...back.start }, { ...back.end }], [{ ...there.end }, { ...there.start }]);
  }
});
