import test from 'node:test';
import assert from 'node:assert/strict';
import { editableMarkdown } from '../src/editableMarkdown.ts';

test('editable document preview retains Markdown headings, lists and tables', () => {
  const html = editableMarkdown('# 标题\n\n**自由编辑**\n\n- 用户\n- 问题\n\n|项目|选择|\n|---|---|\n|范围|自己改|');
  assert.match(html, /<h1>标题<\/h1>/);
  assert.match(html, /<strong>自由编辑<\/strong>/);
  assert.match(html, /<li>用户<\/li>/);
  assert.match(html, /<table>/);
  assert.match(html, /<td>自己改<\/td>/);
});

test('editable document preview never runs pasted HTML or unsafe links and never fetches remote images', () => {
  const html = editableMarkdown('<script>alert(1)</script>\n\n<img src="https://example.test/private" onerror="alert(1)">\n\n[点这里](javascript:alert%281%29)\n\n![附件](https://example.test/image.png)\n\n[正常链接](https://example.test/)');
  assert.doesNotMatch(html, /<(?:script|img|iframe)(?:\s|>)/i);
  assert.doesNotMatch(html, /<[^>]*(?:src|onerror)\s*=/i);
  assert.match(html, /href="https:\/\/example.test\/"/);
  assert.doesNotMatch(html, /href="javascript:/i);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /点这里/);
  assert.match(html, /附件/);
  assert.match(html, /正常链接/);
});
