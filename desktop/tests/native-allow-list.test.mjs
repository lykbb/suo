import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import ts from 'typescript';

// A bridge method lives in three places: the interface calls it, the desktop host (Rust) lets it
// through, and the Node host serves it. The other tests only reach the Node host, so a method
// missing from the Rust allow-list would only fail inside the packaged App.
const source = new URL('../src/', import.meta.url);
const called = new Set();
for (const name of (await readdir(source)).filter(name => /\.tsx?$/.test(name))) {
  const text = await readFile(new URL(name, source), 'utf8');
  const tree = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'request' && ts.isStringLiteral(node.arguments[0])) called.add(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(tree);
}
const rust = await readFile(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');
const list = rust.slice(rust.indexOf('fn bridge_request'), rust.indexOf('这个操作未向界面开放'));
const allowed = new Set([...list.matchAll(/"([a-z]+\.[a-z.-]+)"/g)].map(match => match[1]));
const host = await readFile(new URL('../bridge/host.mjs', import.meta.url), 'utf8');

test('every bridge method the interface calls is let through by the desktop host', () => {
  assert.ok(called.size > 5, 'the interface calls were found');
  assert.deepEqual([...called].filter(method => !allowed.has(method)), []);
});

test('the desktop host lets through only methods the interface calls and the Node host serves', () => {
  assert.deepEqual([...allowed].filter(method => !called.has(method)), []);
  assert.deepEqual([...allowed].filter(method => !host.includes(`case '${method}'`)), []);
});
