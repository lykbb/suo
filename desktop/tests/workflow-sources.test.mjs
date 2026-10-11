import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { editableMarkdown } from '../src/editableMarkdown.ts';
import { safeSourceUrl, sourceLinks, replyWithSources } from '../src/sourceLinks.ts';
import { validReaderMessage } from '../src/readerMessage.ts';
import { WorkspaceStore } from '../bridge/store.mjs';
import { createTestDirectory } from './helpers/test-data.mjs';

async function compile(name, names) {
  const source = await readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');
  const syntax = ts.createSourceFile(name, source, ts.ScriptTarget.ES2022, true, name.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const body = syntax.statements.filter(node => !ts.isImportDeclaration(node) && (!names || names.some(name => node.getText(syntax).includes(name)))).map(node => node.getText(syntax)).join('\n').replaceAll('import.meta.env.BASE_URL', "'/'");
  return ts.transpileModule(body, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
}
const materialCode = await compile('materialContext.ts');
function materials(assets = new Map()) {
  const calls = [], context = { exports: {}, Blob, Uint8Array, Error, AbortController,
    request: async (method, { id }) => { assert.equal(method, 'asset.get'); calls.push(id); const asset = assets.get(id); if (!asset) throw new Error('资料正文读取失败。'); return asset; } };
  vm.runInNewContext(materialCode, context);
  return { ...context.exports, calls };
}

test('search scans the 61st material and includes every card in the reported scope', async () => {
  const cards = Array.from({ length: 61 }, (_, index) => ({ id: `card-${index + 1}`, title: `资料${index + 1}`, content: index === 60 ? '最后一份才有目标用户反馈' : '无匹配词' }));
  const result = await materials().searchMaterials(cards, '目标用户反馈', new AbortController().signal);
  assert.equal(result.hits[0].id, 'card-61');
  assert.equal(result.scanned, 61); assert.equal(result.scopeCount, 61); assert.equal(result.skipped, 0); assert.equal(result.total, 1);
});

test('matching results beyond 20 materials are reachable through successive pages without omissions', async () => {
  const cards = Array.from({ length: 25 }, (_, index) => ({ id: `card-${index + 1}`, title: `调研${index + 1}`, content: '检索关键词' }));
  const h = materials(), signal = new AbortController().signal, ids = [];
  let offset = 0, page;
  do { page = await h.searchMaterials(cards, '检索关键词', signal, offset); ids.push(...page.hits.map(hit => hit.id)); offset = page.next; assert.equal(page.total, 25); assert.equal(page.scanned, 25); } while (offset !== undefined);
  assert.equal(ids.length, 25); assert.equal(new Set(ids).size, 25); assert.equal(ids.at(-1), 'card-25');
  assert.equal((await h.readMaterial(cards[24], 0, signal, false)).text, '检索关键词');
});

test('search distinguishes unreadable files and partial XLSX coverage while preserving spreadsheet preparation and reading', async () => {
  const asset = { id: 'xlsx', kind: 'spreadsheet', name: '调研.xlsx', text: '[工作表：问卷]\n[第 25 行] 关键词', truncated: true, spreadsheet: { sheets: [{}] } };
  const h = materials(new Map([[asset.id, asset]])), card = { id: 'card-xlsx', title: '调研表', content: '', asset }, signal = new AbortController().signal;
  const result = await h.searchMaterials([card, { id: 'bad', title: '丢失文件', content: '', asset: { id: 'missing', kind: 'text', name: 'missing.txt' } }], '关键词', signal);
  assert.equal(result.hits[0].id, card.id); assert.match(result.hits[0].where, /问卷.*25/u);
  assert.equal(result.scanned, 2); assert.equal(result.skipped, 1); assert.equal(result.failed[0].id, 'bad'); assert.equal(result.partial[0].id, card.id);
  assert.match((await h.prepareMaterial(card, signal)).content, /关键词/u);
  assert.match((await h.readMaterial(card, 0, signal, false)).note, /部分行列/u);
});

test('search aborts rather than counting cancelled reads as failed materials', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(materials().searchMaterials([{ id: 'card', title: '资料', content: '关键词' }], '关键词', controller.signal), error => error.name === 'AbortError');
});

test('long app-owned documents disclose their first excerpt and remain readable in later pieces', async () => {
  const h = materials(), card = { title: '完整资料', content: '甲'.repeat(20000) + '后续结论' }, signal = new AbortController().signal;
  const prepared = await h.prepareMaterial(card, signal); assert.equal(prepared.content.length, 20000); assert.match(prepared.note, /可继续读取/u);
  assert.match((await h.readMaterial(card, 20000, signal, false)).text, /后续结论/u);
});

test('Markdown keeps the real web URL and only safe schemes become anchors', () => {
  const url = 'https://example.test/evidence?x=1&y=2#data';
  const html = editableMarkdown(`[调查原文](${url})`);
  assert.match(html, /href="https:\/\/example.test\/evidence\?x=1&amp;y=2#data"/u);
  assert.match(html, /data-source-link="true"/u); assert.match(html, /rel="noopener noreferrer"/u);
  for (const bad of ['javascript:alert(1)', 'data:text/html,test', 'file:///etc/passwd', 'suo-file://private', '//example.test', '/relative', 'https://user:pass@example.test/', 'java\nscript:alert(1)']) assert.equal(safeSourceUrl(bad), undefined, bad);
  assert.equal(safeSourceUrl('HTTPS://EXAMPLE.TEST/source'), 'https://example.test/source');
  assert.doesNotMatch(editableMarkdown('[恶意](javascript:alert%281%29)'), /<a\s/u);
});

test('copying or moving a reply retains the original text and adds only missing safe source Markdown', () => {
  const text = '  原始结论\n\n[已有引用](https://example.test/existing)  ';
  const steps = [{ refs: ['已引用 https://example.test/existing', '报告 [原文] https://example.test/missing?q=1&v=2', '同一链接 https://example.test/missing?q=1&v=2'] }];
  const combined = replyWithSources(text, steps); assert.equal(combined.slice(0, text.length), text);
  assert.equal((combined.match(/https:\/\/example.test\/existing/gu) ?? []).length, 1); assert.equal((combined.match(/https:\/\/example.test\/missing/gu) ?? []).length, 1);
  assert.match(editableMarkdown(combined), /href="https:\/\/example.test\/missing\?q=1&amp;v=2"/u);
  assert.equal(replyWithSources(combined, steps), combined);
});

test('sandbox external-link protocol accepts only the expected channel and safe web URLs', () => {
  const good = { channel: 'reader-token', type: 'reader-external-link', url: 'https://example.test/source' };
  assert.equal(validReaderMessage(good, 'reader-token'), true);
  for (const bad of [{ ...good, channel: 'wrong' }, { ...good, url: 'javascript:alert(1)' }, { ...good, url: 'https://user:pass@example.test' }, { ...good, url: 42 }]) assert.equal(validReaderMessage(bad, 'reader-token'), false);
});

const readerEvents = await readFile(new URL('../public/reader-events.js', import.meta.url), 'utf8');
test('sandbox source clicks send verified URLs without navigating or opening the card, and ignore drag, double-click and selection lock', () => {
  const handlers = new Map(), windowHandlers = new Map(), sent = [], parent = { postMessage: data => sent.push(data) };
  let selected = '';
  vm.runInNewContext(readerEvents, { URL, parent, document: { currentScript: { dataset: { channel: 'reader-token', mode: 'compact' } }, documentElement: { dataset: {} }, createElement: () => ({}), head: { append() {} }, addEventListener: (name, handler) => handlers.set(name, handler) },
    window: { getSelection: () => ({ rangeCount: 0, toString: () => selected, removeAllRanges() {} }), addEventListener: (name, handler) => windowHandlers.set(name, handler) } });
  const anchor = { dataset: { sourceUrl: 'https://example.test/source?x=1&y=2' } }, event = { target: { closest: selector => selector.includes('a[') || selector.startsWith('a,') ? anchor : null }, detail: 1, clientX: 50, clientY: 50, preventDefault() { this.prevented = true; } };
  handlers.get('pointerdown')(event); assert.equal(sent.length, 0);
  handlers.get('click')(event); assert.equal(event.prevented, true); assert.equal(sent.length, 1); assert.equal(sent[0].type, 'reader-external-link'); assert.equal(sent[0].url, anchor.dataset.sourceUrl);
  handlers.get('dblclick')(event); assert.equal(sent.length, 1); handlers.get('click')({ ...event, detail: 2 }); assert.equal(sent.length, 1);
  handlers.get('pointerdown')(event); handlers.get('click')({ ...event, clientX: 57 }); assert.equal(sent.length, 1);
  selected = '拖选'; handlers.get('click')(event); assert.equal(sent.length, 1); selected = '';
  windowHandlers.get('message')({ source: parent, data: { channel: 'reader-token', type: 'reader-selection-lock', locked: true } }); handlers.get('click')(event); assert.equal(sent.length, 1);
  windowHandlers.get('message')({ source: parent, data: { channel: 'reader-token', type: 'reader-selection-lock', locked: false } });
  anchor.dataset.sourceUrl = 'javascript:alert(1)'; handlers.get('click')(event); assert.equal(sent.length, 1);
});

const sanitizerCode = await compile('htmlPreview.ts');
test('the real sanitizer keeps embedded images and styles while converting only safe web anchors to inert source links', () => {
  const node = (tag, attrs = {}, text = '') => ({ tag, attrs: new Map(Object.entries(attrs)), textContent: text, dataset: {}, removed: false,
    get attributes() { return [...this.attrs].map(([name, value]) => ({ name, value })); },
    getAttribute(name) { return this.attrs.get(name) ?? null; }, hasAttribute(name) { return this.attrs.has(name); },
    removeAttribute(name) { this.attrs.delete(name); }, setAttribute(name, value) { this.attrs.set(name, value); }, remove() { this.removed = true; } });
  const safe = node('a', { href: 'https://example.test/source?x=1&y=2', target: '_blank', ping: 'https://tracking.test', 'data-source-url': 'https://forged.test' });
  const unsafe = node('a', { href: 'javascript:alert(1)', 'data-source-url': 'https://forged.test' });
  const local = node('a', { href: '#section' }), dataLink = node('a', { href: 'data:image/png;base64,fixture' }), image = node('img', { src: 'data:image/png;base64,fixture' }), remote = node('img', { src: 'https://remote.test/image' }), style = node('style', {}, 'p { color: black; }'), script = node('script', {}, 'alert(1)');
  const nodes = [safe, unsafe, local, dataLink, image, remote, style, script], head = [], body = [];
  const doc = { querySelectorAll(selector) { return nodes.filter(item => !item.removed && (selector === '*' || selector.split(',').includes(item.tag))); },
    createElement: tag => node(tag), head: { prepend: (...items) => head.unshift(...items), append: item => head.push(item) }, body: { append: item => body.push(item) },
    documentElement: { get outerHTML() { return `<html>${[...head, ...nodes, ...body].filter(item => !item.removed).map(item => `<${item.tag} ${[...item.attrs].map(([name, value]) => `${name}="${value}"`).join(' ')}>${item.textContent}</${item.tag}>`).join('')}</html>`; } } };
  const context = { exports: {}, URL, safeSourceUrl, window: { location: { origin: 'https://suo.test' } }, DOMParser: class { parseFromString() { return doc; } } };
  vm.runInNewContext(sanitizerCode, context);
  const html = context.exports.safeHtml('fixture', true, { channel: '01234567-89ab-4def-8123-0123456789ab', scriptUrl: 'https://suo.test/reader-events.js' });
  assert.equal(safe.getAttribute('href'), '#'); assert.equal(safe.getAttribute('data-source-url'), 'https://example.test/source?x=1&y=2'); assert.equal(safe.getAttribute('target'), null); assert.equal(safe.getAttribute('ping'), null);
  assert.equal(unsafe.getAttribute('href'), null); assert.equal(unsafe.getAttribute('data-source-url'), null); assert.equal(local.getAttribute('href'), '#section');
  assert.equal(dataLink.getAttribute('href'), null); assert.equal(safe.getAttribute('title'), 'https://example.test/source?x=1&y=2');
  assert.equal(image.getAttribute('src'), 'data:image/png;base64,fixture'); assert.equal(remote.getAttribute('src'), null); assert.equal(style.removed, false); assert.equal(script.removed, true);
  assert.match(html, /p \{ color: black; \}/u); assert.match(html, /data:image\/png;base64,fixture/u); assert.doesNotMatch(html, /alert\(1\)|forged\.test|remote\.test/u);
  assert.equal(body[0].src, 'https://suo.test/reader-events.js'); assert.equal(body[0].dataset.channel, '01234567-89ab-4def-8123-0123456789ab');
});

const htmlReaderCode = await compile('HtmlReader.tsx');
test('the actual sandbox parent rejects messages from another frame or channel before opening a source', async () => {
  const sent = [], updates = [], refs = [], effects = [], listeners = new Map(), contentWindow = {};
  const require = createRequire(import.meta.url), context = { exports: {}, require, memo: value => value, URL, Error, validReaderMessage,
    useRef: value => { const ref = { current: value }; refs.push(ref); return ref; }, useState: fn => [typeof fn === 'function' ? fn() : fn], useMemo: fn => fn(), useEffect: fn => effects.push(fn),
    crypto: { randomUUID: () => '01234567-89ab-4def-8123-0123456789ab' }, safeHtml: () => '<html>safe</html>', app: { set: value => updates.push(value) },
    window: { location: { href: 'https://suo.test/' }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) },
    openExternal: async url => sent.push(url) };
  vm.runInNewContext(htmlReaderCode, context); context.exports.default({ text: '<a>原文</a>', title: '导入Markdown' }); refs[0].current = { contentWindow };
  const cleanup = effects.map(fn => fn()), receive = listeners.get('message'), data = { channel: '01234567-89ab-4def-8123-0123456789ab', type: 'reader-external-link', url: 'https://example.test/source' };
  receive({ source: {}, data }); receive({ source: contentWindow, data: { ...data, channel: 'forged' } }); receive({ source: contentWindow, data: { ...data, url: 'javascript:alert(1)' } }); assert.equal(sent.length, 0);
  receive({ source: contentWindow, data }); assert.deepEqual(sent, [data.url]);
  context.openExternal = async () => { throw new Error('来源打开失败，请重试。'); }; receive({ source: contentWindow, data }); await Promise.resolve(); assert.equal(updates[0].toast, '来源打开失败，请重试。');
  cleanup.forEach(fn => fn?.()); assert.equal(listeners.size, 0);
});

const eventsCode = await compile('sourceLinkEvents.ts');
function linkEvents() {
  const opened = [], updates = []; let selection = '';
  class Element { constructor(anchor) { this.anchor = anchor; } closest() { return this.anchor; } }
  const context = { exports: {}, Element, safeSourceUrl, app: { set: value => updates.push(value) }, window: { getSelection: () => ({ toString: () => selection }) }, openExternal: async url => opened.push(url) };
  vm.runInNewContext(eventsCode, context);
  const event = (url, detail = 1) => { const counts = { stopped: 0, prevented: 0 }; return { detail, clientX: 100, clientY: 100, target: new Element({ getAttribute: () => url }), stopPropagation: () => counts.stopped++, preventDefault: () => counts.prevented++, counts }; };
  return { ...context.exports, opened, updates, event, setSelection: value => { selection = value; } };
}

test('source clicks use the desktop opener only on deliberate web-link activation and keep canvas gestures separate', () => {
  const h = linkEvents(), click = h.event('https://example.test/original');
  h.sourcePointerDown(click); assert.equal(click.counts.stopped, 1); assert.equal(click.counts.prevented, 0);
  h.sourceClick(click); assert.deepEqual(h.opened, ['https://example.test/original']); assert.equal(click.counts.prevented, 1);
  assert.equal(h.sourceDoubleClick(click), true); assert.equal(h.opened.length, 1);
  h.sourceClick(h.event('https://example.test/original', 2)); assert.equal(h.opened.length, 1);
  h.setSelection('拖选的文字'); h.sourceClick(h.event('https://example.test/original')); assert.equal(h.opened.length, 1);
  h.sourceClick(h.event('https://example.test/keyboard', 0)); assert.equal(h.opened.at(-1), 'https://example.test/keyboard');
  h.sourceClick(h.event('javascript:alert(1)', 0)); assert.equal(h.opened.length, 2);
  h.setSelection(''); const dragged = h.event('https://example.test/dragged'); h.sourcePointerDown(dragged); dragged.clientX = 108; h.sourceClick(dragged); assert.equal(h.opened.length, 2);
  const plain = { ...click, target: null }; assert.equal(h.sourceDoubleClick(plain), false);
});

const sourcesCode = await compile('SourceLinks.tsx');
const sourcesContext = { exports: {}, require: createRequire(import.meta.url), sourceLinks, sourceClick() {}, sourcePointerDown() {}, sourceDoubleClick() {} };
vm.runInNewContext(sourcesCode, sourcesContext);
const SourceLinks = sourcesContext.exports.default;
test('saved and reloaded reply references render as ordinary black-and-white source links without duplicates', async () => {
  const root = await createTestDirectory('workflow-source-refs-'), store = new WorkspaceStore(root), original = await store.create();
  const refs = ['用户研究 https://example.test/original?x=1&y=2', '重复来源 https://example.test/original?x=1&y=2', '不安全 javascript:alert(1)'];
  const message = { id: 'reply', role: 'assistant', text: '结论有原文可核验。', steps: [{ id: 'search', label: '查找资料', status: 'done', refs }] };
  await store.save({ ...original, messages: [message] }, original.version);
  const saved = await store.load(original.id); assert.deepEqual(saved.messages[0].steps[0].refs, refs);
  const markup = renderToStaticMarkup(React.createElement(SourceLinks, { steps: saved.messages[0].steps }));
  assert.match(markup, /来源：/u); assert.match(markup, /用户研究/u); assert.match(markup, /href="https:\/\/example.test\/original\?x=1&amp;y=2"/u);
  assert.equal((markup.match(/<a /gu) ?? []).length, 1); assert.doesNotMatch(markup, /javascript|技术详情|<small|<details/u);
  const panels = await readFile(new URL('../src/Panels.tsx', import.meta.url), 'utf8');
  assert.match(panels, /<SourceLinks steps=\{message\.steps\}/u);
});
