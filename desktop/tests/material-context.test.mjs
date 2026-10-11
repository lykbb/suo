import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { extractPdfText } from '../src/pdfText.mjs';

const source = await readFile(new URL('../src/materialContext.ts', import.meta.url), 'utf8');
const syntax = ts.createSourceFile('materialContext.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
const standalone = syntax.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(syntax)).join('\n').replaceAll('import.meta.env.BASE_URL', "'/'");
const code = ts.transpileModule(standalone, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const sourceBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jg6kAAAAASUVORK5CYII=', 'base64');
const renderedBytes = Buffer.from([0xff, 0xd8, ...Buffer.from('local-canvas-output-fixture'), 0xff, 0xd9]);
const imageAsset = () => ({ id: 'image-fixture', name: '真实截图.png', kind: 'image', mime: 'image/png', size: sourceBytes.length, base64: sourceBytes.toString('base64') });

function materialHarness(asset, { afterBitmap } = {}) {
  const calls = [], fetched = [], decoded = [], canvasCalls = [];
  let closed = 0;
  const bitmap = { width: 3072, height: 1536, close() { closed++; } };
  const drawing = {
    fillStyle: '', fillRect: (...args) => canvasCalls.push({ method: 'fillRect', args }),
    drawImage: (...args) => canvasCalls.push({ method: 'drawImage', args }),
  };
  const canvas = {
    width: 0, height: 0,
    getContext: kind => { assert.equal(kind, '2d'); return drawing; },
    toDataURL: (mime, quality) => {
      canvasCalls.push({ method: 'toDataURL', mime, quality });
      return `data:${mime};base64,${renderedBytes.toString('base64')}`;
    },
  };
  const context = {
    exports: {}, Blob, Uint8Array, Error, AbortController, atob, extractPdfText,
    require: path => { throw new Error('Unexpected module in a local material fixture: ' + path); },
    request: async (method, payload) => { calls.push({ method, payload }); assert.equal(method, 'asset.get'); assert.equal(payload.id, asset.id); return asset; },
    fetch: async (url, options) => { fetched.push({ url, options }); return { ok: true, blob: async () => new Blob([sourceBytes], { type: asset.mime }) }; },
    createImageBitmap: async blob => { decoded.push(Buffer.from(await blob.arrayBuffer())); afterBitmap?.(); return bitmap; },
    document: { createElement: name => { assert.equal(name, 'canvas'); return canvas; } },
  };
  vm.runInNewContext(code, context);
  const card = { title: '产品资料', content: '只有文件名的旧占位内容', asset: { id: asset.id } };
  return { ...context.exports, card, calls, fetched, decoded, canvasCalls, canvas, bitmap, closed: () => closed };
}

test('text and Word materials send the actual fetched body rather than a file name or short preview', async () => {
  for (const kind of ['text', 'word']) {
    const body = '# 用户访谈\n用户每次都要重复填写 6 个字段。\n下一步验证：统计一周内的重复录入次数。';
    const asset = { id: `${kind}-fixture`, name: '访谈资料.docx', kind, mime: 'text/plain', size: 128, preview: '仅有短预览', text: body };
    const h = materialHarness(asset), controller = new AbortController();
    const material = await h.prepareMaterial(h.card, controller.signal);
    assert.equal(material.title, '产品资料');
    assert.equal(material.content, body);
    assert.notEqual(material.content, asset.name);
    assert.notEqual(material.content, asset.preview);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].payload.id, asset.id);
    assert.equal(h.fetched.length, 0);
    assert.equal(material.image, undefined);
  }
});

test('oversized text includes its real beginning and explicitly reports the excerpt', async () => {
  const asset = { id: 'long-text', name: '长访谈.md', kind: 'text', mime: 'text/markdown', size: 60003, text: '甲'.repeat(20001) };
  const h = materialHarness(asset);
  const material = await h.prepareMaterial(h.card, new AbortController().signal);
  assert.equal(material.content, asset.text.slice(0, 20000));
  assert.match(material.note, /截取/u);
});

test('an embedded image passes actual decoded bytes through bitmap and canvas into base64 visual content', async () => {
  const h = materialHarness(imageAsset());
  const material = await h.prepareMaterial(h.card, new AbortController().signal);
  assert.equal(h.fetched.length, 0);
  assert.deepEqual(h.decoded, [sourceBytes]);
  assert.equal(h.canvas.width, 1536);
  assert.equal(h.canvas.height, 768);
  assert.equal(h.canvasCalls.some(call => call.method === 'drawImage' && call.args[0] === h.bitmap), true);
  assert.equal(material.image.mimeType, 'image/jpeg');
  assert.equal(material.image.data, renderedBytes.toString('base64'));
  assert.deepEqual(Buffer.from(material.image.data, 'base64'), renderedBytes);
  assert.notEqual(material.image.data, h.card.title);
  assert.match(material.note, /视觉内容/u);
  assert.equal(h.closed(), 1);
});

test('a local image URL is fetched with the same abort signal and contributes its source bytes', async () => {
  const asset = { ...imageAsset(), base64: undefined, sourceUrl: 'suo-file://local-image-fixture' };
  const h = materialHarness(asset), controller = new AbortController();
  const material = await h.prepareMaterial(h.card, controller.signal);
  assert.equal(h.fetched.length, 1);
  assert.equal(h.fetched[0].url, asset.sourceUrl);
  assert.equal(h.fetched[0].options.signal, controller.signal);
  assert.deepEqual(h.decoded, [sourceBytes]);
  assert.deepEqual(Buffer.from(material.image.data, 'base64'), renderedBytes);
  assert.equal(h.closed(), 1);
});

test('cancelled material preparation makes no asset request and closes a bitmap when cancellation arrives after decoding', async () => {
  const before = new AbortController(); before.abort();
  const untouched = materialHarness(imageAsset());
  await assert.rejects(untouched.prepareMaterial(untouched.card, before.signal), error => error.name === 'AbortError');
  assert.equal(untouched.calls.length, 0);
  const during = new AbortController(), h = materialHarness(imageAsset(), { afterBitmap: () => during.abort() });
  await assert.rejects(h.prepareMaterial(h.card, during.signal), error => error.name === 'AbortError');
  assert.equal(h.closed(), 1);
  assert.equal(h.canvasCalls.length, 0);
});

test('unsupported image locations and source files above the limit cannot trigger a network read', async () => {
  for (const asset of [
    { ...imageAsset(), base64: undefined, sourceUrl: 'https://untrusted.example.test/private-image.png' },
    { ...imageAsset(), size: 20 * 1024 * 1024 + 1 },
  ]) {
    const h = materialHarness(asset);
    await assert.rejects(h.prepareMaterial(h.card, new AbortController().signal), /重新导入|20 MB/u);
    assert.equal(h.fetched.length, 0);
    assert.equal(h.decoded.length, 0);
  }
});

function pdfFixture(pages, onTextContent) {
  const requested = [], cleaned = [];
  return {
    requested, cleaned,
    pdf: {
      numPages: pages.length,
      async getPage(number) {
        requested.push(number);
        return {
          async getTextContent() { onTextContent?.(number); return { items: pages[number - 1] }; },
          cleanup() { cleaned.push(number); },
        };
      },
    },
  };
}

test('PDF text extraction preserves page labels, text items and line breaks in reading order', async () => {
  const h = pdfFixture([
    [{ str: '背景与问题', hasEOL: true }, { str: '重复录入' }, { image: 'non-text-item' }],
    [{ str: '下一步验证', hasEOL: true }, { str: '观察真实操作。' }],
  ]);
  const result = await extractPdfText(h.pdf, { signal: new AbortController().signal });
  assert.match(result.text, /\[第 1 页\]\n背景与问题\n重复录入/u);
  assert.match(result.text, /\[第 2 页\]\n下一步验证\n观察真实操作。/u);
  assert(result.text.indexOf('重复录入') < result.text.indexOf('下一步验证'));
  assert.equal(result.pages, 2);
  assert.equal(result.truncated, false);
  assert.deepEqual(h.requested, [1, 2]);
  assert.deepEqual(h.cleaned, [1, 2]);
});

test('PDF page and character limits stop further page reads and report incomplete extraction', async () => {
  const byPage = pdfFixture([[{ str: '第一页正文' }], [{ str: '第二页正文' }]]);
  const first = await extractPdfText(byPage.pdf, { maxPages: 1 });
  assert.equal(first.pages, 1);
  assert.equal(first.truncated, true);
  assert.match(first.text, /第一页正文/u);
  assert.doesNotMatch(first.text, /第二页正文/u);
  assert.deepEqual(byPage.requested, [1]);
  const byChars = pdfFixture([[{ str: '甲'.repeat(100) }], [{ str: '不应读取第二页' }]]);
  const excerpt = await extractPdfText(byChars.pdf, { maxChars: 30 });
  assert(excerpt.text.length <= 30);
  assert.equal(excerpt.truncated, true);
  assert.equal(excerpt.pages, 1);
  assert.deepEqual(byChars.requested, [1]);
  assert.deepEqual(byChars.cleaned, [1]);
});

test('a scanned PDF with no extractable text reports the limitation instead of sending a filename', async () => {
  const h = pdfFixture([[], [{ str: '  ' }, { image: 'scanned-page' }]]);
  await assert.rejects(extractPdfText(h.pdf), /没有可提取的文字.*扫描件/u);
  assert.deepEqual(h.requested, [1, 2]);
  assert.deepEqual(h.cleaned, [1, 2]);
});

test('PDF extraction respects cancellation before reading and after an asynchronous text-content result', async () => {
  const before = new AbortController(); before.abort();
  const untouched = pdfFixture([[{ str: '不会读取' }]]);
  await assert.rejects(extractPdfText(untouched.pdf, { signal: before.signal }), error => error.name === 'AbortError');
  assert.deepEqual(untouched.requested, []);
  const during = new AbortController();
  const interrupted = pdfFixture([[{ str: '取消前的第一页' }], [{ str: '不应读取第二页' }]], () => during.abort());
  await assert.rejects(extractPdfText(interrupted.pdf, { signal: during.signal }), error => error.name === 'AbortError');
  assert.deepEqual(interrupted.requested, [1]);
});
