import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { useEffect, useRef, useState, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as jsxRuntime from 'react/jsx-runtime';
import { FileStore } from '../bridge/files.mjs';
import { fileKind } from '../bridge/formats.mjs';
import { readXlsx } from '../bridge/spreadsheet-node.mjs';
import { readBrowserXlsx } from '../src/spreadsheetBrowser.mjs';
import { spreadsheetText, SPREADSHEET_LIMITS, XLS_MESSAGE } from '../bridge/spreadsheet.mjs';
import { columnLabel } from '../bridge/spreadsheet.mjs';
import { createTestDirectory } from './helpers/test-data.mjs';
import { syntheticXlsx, xlsxEntries, zipEntries } from './helpers/spreadsheet-fixture.mjs';

test('real compressed XLSX uses identical Node zlib and browser pako readers, preserving every question and cell text', async () => {
  const bytes = syntheticXlsx(), node = await readXlsx(bytes), browser = await readBrowserXlsx(bytes);
  assert.deepEqual(browser, node); assert.equal(node.sheets.length, 2); assert.equal(node.sheetCount, 2); assert.equal(node.limited, false);
  const questions = node.sheets[0]; assert.equal(questions.rows.length, 25); assert.equal(questions.visibleColumns, 2);
  assert.match(questions.rows[0][0], /^问题 1：/u); assert.match(questions.rows[24][0], /^问题 25：/u); assert.equal(questions.rows[0][1], '001');
  const text = node.sheets[1]; assert.deepEqual(text.rows[0], [' 文字 & <原文>\n第二行', '00123', '000123', '12345678901234567890', '3', '甲乙', '[公式无缓存结果]', '<script>alert(1)</script>']);
  assert.deepEqual(text.rows[1], []); assert.equal(text.rows[2][0], undefined); assert.equal(text.rows[2][1], '保留空行与空列');
  assert.equal(text.formulas.E1, 'SUM(1,2)'); assert.match(text.formulas.G1, /^WEBSERVICE/u);
  const material = spreadsheetText(node); assert.match(material.text, /\[工作表：问卷原文\]/u); assert.match(material.text, /\[第 25 行\] A25=/u); assert.equal(material.truncated, false);
});

test('stored ZIP entries, sparse row coordinates and inline rich strings are supported', async () => {
  const bytes = zipEntries(xlsxEntries({ firstSheet: '<worksheet><sheetData><row r="4"><c r="C4" t="inlineStr"><is><r><t xml:space="preserve"> 前 </t></r><r><t>后</t></r></is></c></row></sheetData></worksheet>' }), { stored: true });
  const book = await readXlsx(bytes); assert.equal(book.sheets[0].rows[3][2], ' 前 后'); assert.equal(book.sheets[0].rows.length, 4); assert.deepEqual(await readBrowserXlsx(bytes), book);
});

test('historical binary XLSX imports become parsed metadataOnly assets without rewriting original or metadata', async () => {
  const dir = await createTestDirectory('xlsx-legacy-'), store = new FileStore(join(dir, 'state')), id = randomUUID(), bytes = syntheticXlsx();
  await mkdir(store.root, { recursive: true });
  const metadata = JSON.stringify({ id, name: '旧问卷.xlsx', size: bytes.length, kind: 'binary', mime: 'application/octet-stream' });
  await writeFile(join(store.root, `${id}.json`), metadata, { flag: 'wx' }); await writeFile(join(store.root, `${id}.bin`), bytes, { flag: 'wx' });
  const loaded = await store.get(id, { metadataOnly: true });
  assert.equal(loaded.kind, 'spreadsheet'); assert.equal(loaded.base64, undefined); assert.equal(loaded.spreadsheet.sheets[0].rows.length, 25); assert.match(loaded.text, /问题 25/u);
  assert.equal(await readFile(join(store.root, `${id}.json`), 'utf8'), metadata); assert.deepEqual(await readFile(join(store.root, `${id}.bin`)), bytes);
  const source = join(dir, '新问卷.xlsx'); await writeFile(source, bytes, { flag: 'wx' });
  const [asset] = await store.importPaths([source]); assert.equal(asset.kind, 'spreadsheet'); assert.equal((await store.get(asset.id)).spreadsheet.sheets.length, 2);
});

function compiledWithoutImports(source, name) {
  const syntax = ts.createSourceFile(name, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const standalone = syntax.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(syntax)).join('\n').replaceAll('import.meta.env.BASE_URL', "'/'");
  return ts.transpileModule(standalone, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
}

test('browser historical binary Blob imports reclassify and run the actual pako reader without a re-import', async () => {
  const source = await readFile(new URL('../src/browserStorage.ts', import.meta.url), 'utf8'), bytes = syntheticXlsx(), id = randomUUID();
  const saved = { asset: { id, name: '已导入问卷.xlsx', size: bytes.length, kind: 'binary', mime: 'application/octet-stream' }, blob: new Blob([bytes]) };
  const database = { transaction: () => ({ objectStore: () => ({ get: key => { assert.equal(key, id); const req = { result: saved }; queueMicrotask(() => req.onsuccess()); return req; } }) }) };
  const exports = {}; const context = { exports, Blob, Uint8Array, Error, DOMException, URL, fileKind, readBrowserXlsx, spreadsheetText, SPREADSHEET_LIMITS, XLS_MESSAGE, indexedDB: { open: () => { const req = { result: database }; queueMicrotask(() => req.onsuccess()); return req; } } };
  runInNewContext(compiledWithoutImports(source, 'browserStorage.ts'), context);
  const loaded = await exports.loadBrowserAsset(id); assert.equal(loaded.kind, 'spreadsheet'); assert.equal(loaded.spreadsheet.sheets[0].rows[24][1], '025'); assert.match(loaded.text, /问题 25/u); assert.equal(saved.asset.kind, 'binary');
  assert.equal(await exports.loadBrowserAsset(id), loaded);
});

test('prepareMaterial, read_material and search_materials read real XLSX text and find a historical binary card', async () => {
  const source = await readFile(new URL('../src/materialContext.ts', import.meta.url), 'utf8'), book = await readXlsx(syntheticXlsx()), loaded = { id: 'questionnaire', name: '问卷.xlsx', kind: 'spreadsheet', spreadsheet: book, ...spreadsheetText(book) };
  const exports = {}, context = { exports, Blob, Uint8Array, Error, AbortController, request: async () => loaded };
  runInNewContext(compiledWithoutImports(source, 'materialContext.ts'), context);
  const signal = new AbortController().signal, card = { id: 'card-questionnaire', title: '用户调研', content: '', asset: { ...loaded, kind: 'binary', spreadsheet: undefined, text: undefined } };
  const prepared = await exports.prepareMaterial(card, signal); assert.match(prepared.content, /问题 25/u); assert.match(prepared.note, /2 个工作表/u);
  const read = await exports.readMaterial(card, 0, signal, false); assert.match(read.text, /问题 25/u); assert.match(read.text, /000123/u);
  const result = await exports.searchMaterials([card], '问题 25', signal); assert.equal(result.hits[0].id, card.id); assert.match(result.hits[0].where, /问卷原文/u); assert.equal(result.skipped, 0);
  loaded.error = XLS_MESSAGE; await assert.rejects(exports.prepareMaterial(card, signal), /另存为 \.xlsx/u);
});

test('row and column limits preserve early cells and explicitly mark truncation', async () => {
  const book = await readXlsx(syntheticXlsx({ firstSheet: '<worksheet><dimension ref="A1:CW2001"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>第一行没有丢</t></is></c><c r="CW1" t="inlineStr"><is><t>超出列范围</t></is></c></row><row r="2001"><c r="A2001" t="inlineStr"><is><t>超出行范围</t></is></c></row></sheetData></worksheet>' }));
  assert.equal(book.sheets[0].rows[0][0], '第一行没有丢'); assert.equal(book.sheets[0].rows.length, 2000); assert.equal(book.sheets[0].visibleColumns, 100); assert.equal(book.limited, true);
  const material = spreadsheetText(book); assert.equal(material.truncated, true); assert.match(material.text, /内容已截取/u); assert.match(material.text, /2000 行\/表/u);
});

test('the real spreadsheet reader renders first and last questionnaire rows and safely escapes cell text', async () => {
  const source = await readFile(new URL('../src/SpreadsheetReader.tsx', import.meta.url), 'utf8');
  const syntax = ts.createSourceFile('SpreadsheetReader.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const standalone = syntax.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(syntax)).join('\n');
  const compiled = ts.transpileModule(standalone, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, useEffect, useRef, useState, columnLabel, require: name => { assert.equal(name, 'react/jsx-runtime'); return jsxRuntime; } });
  const book = await readXlsx(syntheticXlsx());
  const html = renderToStaticMarkup(createElement(exports.default, { book }));
  assert.match(html, /问题 1：/u); assert.match(html, /问题 25：/u); assert.match(html, /文字与公式/u); assert.match(html, /<th scope="row">1<\/th>/u);
  const escaped = renderToStaticMarkup(createElement(exports.default, { book: { ...book, sheets: [book.sheets[1]] } }));
  assert.match(escaped, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u); assert.doesNotMatch(escaped, /<script>/u);
});

test('a character-limit hit stays visible to material preparation and reading even when no footer fits', async () => {
  const book = await readXlsx(syntheticXlsx({ firstSheet: `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${'x'.repeat(999990)}</t></is></c></row></sheetData></worksheet>` }));
  const payload = spreadsheetText(book); assert.ok(payload.text.length >= SPREADSHEET_LIMITS.chars - 1 && payload.text.length <= SPREADSHEET_LIMITS.chars); assert.equal(payload.truncated, true);
  const source = await readFile(new URL('../src/materialContext.ts', import.meta.url), 'utf8'), exports = {};
  runInNewContext(compiledWithoutImports(source, 'materialContext.ts'), { exports, Blob, Uint8Array, Error, AbortController, request: async () => ({ kind: 'spreadsheet', spreadsheet: book, ...payload }) });
  const card = { title: '长表', content: '', asset: { id: 'long' } }, signal = new AbortController().signal;
  assert.match((await exports.prepareMaterial(card, signal)).note, /部分内容已截取/u);
  assert.match((await exports.readMaterial(card, 0, signal, false)).note, /部分行列或工作表超出读取范围/u);
});

test('XLS explicitly asks for conversion and damaged, encrypted, duplicate, traversal, corrupt and oversized ZIPs fail safely', async () => {
  assert.equal(fileKind('历史.XLS').kind, 'spreadsheet'); const dir = await createTestDirectory('xlsx-errors-'), store = new FileStore(join(dir, 'state'));
  const legacy = join(dir, '旧表.xls'); await writeFile(legacy, 'legacy binary', { flag: 'wx' }); const [asset] = await store.importPaths([legacy]); assert.equal((await store.get(asset.id, { metadataOnly: true })).error, XLS_MESSAGE);
  const encrypted = syntheticXlsx(); encrypted.writeUInt16LE(1, 6); await assert.rejects(readXlsx(encrypted), /XLSX/u);
  const corrupt = zipEntries(xlsxEntries(), { stored: true }); const secondHeader = 30 + corrupt.readUInt16LE(26) + corrupt.readUInt32LE(18), relData = secondHeader + 30 + corrupt.readUInt16LE(secondHeader + 26); corrupt[relData] ^= 1; await assert.rejects(readXlsx(corrupt), /XLSX/u);
  for (const entries of [[...xlsxEntries(), { name: '../escape.xml', text: '' }], [...xlsxEntries(), xlsxEntries()[0]], [...xlsxEntries(), { name: 'bomb.xml', text: 'small', declaredSize: SPREADSHEET_LIMITS.entryBytes + 1 }]]) await assert.rejects(readXlsx(zipEntries(entries)), /XLSX/u);
  await assert.rejects(readXlsx(Buffer.from('not a zip')), /XLSX/u);
  for (const firstSheet of ['<!DOCTYPE x [<!ENTITY stolen SYSTEM "file:///etc/passwd">]><worksheet/>', '<worksheet><sheetData></worksheet>', '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>&stolen;</t></is></c></row></sheetData></worksheet>']) await assert.rejects(readXlsx(syntheticXlsx({ firstSheet })), /XLSX/u);
  const damaged = join(dir, '损坏.xlsx'); await writeFile(damaged, 'not a zip', { flag: 'wx' }); const [bad] = await store.importPaths([damaged]); assert.match((await store.get(bad.id, { metadataOnly: true })).error, /XLSX/u);
});
