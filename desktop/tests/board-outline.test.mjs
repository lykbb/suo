import test from 'node:test';
import assert from 'node:assert/strict';
import { boardOutline } from '../src/boardOutline.ts';

const card = (id, title, extra = {}) => ({ id, type: 'card', position: { x: 0, y: 0 }, data: { kind: 'note', title, content: '很长的正文不该出现在简况里' }, ...extra });

test('the board outline lists cards, groups and lines without their text or positions', () => {
  const group = { id: 'g', type: 'group', position: { x: 0, y: 0 }, data: { kind: 'group', title: '用户痛点', content: '' } };
  const nodes = [group, card('a', '访谈记录分散', { parentId: 'g', selected: true }), card('b', '', { data: { kind: 'document', title: '', content: '' } }),
    card('f', '访谈.pdf', { data: { kind: 'note', title: '访谈.pdf', content: '', asset: { id: 'x', name: '访谈.pdf', kind: 'pdf' } } })];
  const outline = boardOutline(nodes, [{ id: '1', source: 'a', target: 'b', label: ' 导致 ' }, { id: '2', source: 'b', target: 'f' }]);
  assert.equal(outline, [
    '共 3 张卡片、1 个分组、2 条连线。',
    '- [a] 访谈记录分散（便签，在分组「用户痛点」里，已选中）',
    '- [b] 未命名（文档）',
    '- [f] 访谈.pdf（资料）',
    '分组：', '- [g] 用户痛点',
    '连线（箭头表示方向，括号里是关系）：', '- [a] → [b]（导致）', '- [b] → [f]',
  ].join('\n'));
  assert.doesNotMatch(outline, /正文|@/u);
  assert.equal(boardOutline([], []), '画布是空的。');
});

test('a large board lists the selected and newest cards first and says how many there are', () => {
  const nodes = Array.from({ length: 80 }, (_, i) => card(`c${i}`, `卡片${i}`, { selected: i === 3 }));
  const lines = boardOutline(nodes, [], 5).split('\n');
  assert.equal(lines[0], '共 80 张卡片、0 个分组、0 条连线；卡片较多，只列出选中的和最新的 5 张。');
  assert.deepEqual(lines.slice(1).map(line => line.match(/\[(c\d+)\]/u)[1]), ['c3', 'c79', 'c78', 'c77', 'c76']);
});
