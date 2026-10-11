import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { presentMessageError, messageDisplayText } from '../src/messageError.mjs';
const root = process.env.SUO_CHAT_SOURCE ?? fileURLToPath(new URL('../src', import.meta.url));
const source = await readFile(join(root, 'MessageError.tsx'), 'utf8');
const syntax = ts.createSourceFile('MessageError.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
const code = ts.transpileModule(syntax.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(syntax)).join('\n'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const events = [], updates = [];
const context = { exports: {}, require: createRequire(import.meta.url), useMemo: React.useMemo, presentMessageError,
  Icon: ({ name }) => React.createElement('svg', { 'data-icon': name }), Event,
  window: { dispatchEvent: event => events.push(event.type) }, app: { set: patch => updates.push(patch) } };
vm.runInNewContext(code, context);
const { default: MessageError } = context.exports;
test('historical errors render only friendly text without raw details or a framed card', () => {
  const error = 'HTTP 503: {"code":"model_not_found","api_key":"fixture-secret","request_id":"fixture-request"}';
  const markup = renderToStaticMarkup(React.createElement(MessageError, { error }));
  assert.match(markup, /当前模型暂时不可用/);
  assert.match(markup, /模型名称或接口地址/);
  assert.match(markup, /role="alert"/);
  assert.doesNotMatch(markup, /details|summary>|pre>|技术详情|HTTP|503|model_not_found|fixture-secret|fixture-request|message-error-card/);
});
test('ordinary message text keeps its exact formatting for the shared actions', () => {
  const text = '  第一段\n\n第二段  ';
  assert.equal(messageDisplayText({ text }), text);
  assert.equal(messageDisplayText(), '');
});
test('a pure error supplies the same readable title and reason for both actions', () => {
  const error = 'HTTP 401: {"api_key":"fixture-secret","message":"invalid_api_key"}';
  const result = presentMessageError(error);
  assert.equal(messageDisplayText({ error }), `${result.title}\n\n${result.reason}`);
  assert.doesNotMatch(messageDisplayText({ error }), /HTTP|401|fixture-secret|invalid_api_key/);
});
