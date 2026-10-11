import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
const root = process.env.SUO_CHAT_SOURCE ?? fileURLToPath(new URL('../src', import.meta.url));
function compile(source, name) {
  const syntax = ts.createSourceFile(name, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  return ts.transpileModule(syntax.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(syntax)).join('\n'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
const code = compile(await readFile(join(root, 'agentTools.ts'), 'utf8'), 'agentTools.ts');
for (const [query, engine] of [['AI 产品调研', 'baidu'], ['product market research', 'bing'], ['SaaS 竞品 pricing', 'baidu']]) {
  test(`search routes ${query} automatically without reading a saved override`, async () => {
    const calls = [];
    const context = { exports: {}, AbortSignal, preferences: { get: () => { throw new Error('Old preference must not be read'); } }, browserSearch: async (...args) => { calls.push(args); return { results: [{ title: 'Fixture result' }] }; } };
    vm.runInNewContext(code, context);
    const result = await context.exports.handleUiRequest('web.search', { query });
    assert.deepEqual(calls, [[query, engine]]);
    assert.equal(result.results[0].title, 'Fixture result');
  });
}
test('legacy search overrides disappear while other saved preferences survive', async () => {
  const source = compile(await readFile(join(root, 'preferences.ts'), 'utf8'), 'preferences.ts');
  const context = { exports: {}, localStorage: { getItem: () => '{}' }, createStore: value => ({ get: () => value }) };
  vm.runInNewContext(source, context);
  for (const searchEngine of ['baidu', 'bing', 'auto']) {
    const result = context.exports.normalizePreferences({ searchEngine, theme: 'dark', background: 'grid', motion: 'reduce', sendKey: 'modifier-enter' });
    assert.deepEqual(JSON.parse(JSON.stringify(result)), { theme: 'dark', background: 'grid', motion: 'reduce', sendKey: 'modifier-enter' });
  }
});
