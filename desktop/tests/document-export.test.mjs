import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../src/actions.ts', import.meta.url), 'utf8');
const syntax = ts.createSourceFile('actions.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
const declaration = syntax.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'documentMarkdown');
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(declaration.getText(syntax), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
const { documentMarkdown } = context.exports;

test('a document exports as Markdown with a safe file name and one title', () => {
  assert.deepEqual({ ...documentMarkdown('访谈提纲', '一、背景\n内容') }, { name: '访谈提纲.md', text: '# 访谈提纲\n\n一、背景\n内容\n' });
  assert.equal(documentMarkdown('PRD', '# 智能纪要 PRD\n\n正文').text, '# 智能纪要 PRD\n\n正文\n');
  assert.equal(documentMarkdown('a/b:c*?"<>|\n d', '').name, 'a b c d.md');
  assert.equal(documentMarkdown('  ', '内容').name, '文档.md');
  assert.equal(documentMarkdown('x'.repeat(200), '').name.length, 83);
});
