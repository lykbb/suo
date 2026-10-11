import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createTestDirectory } from './helpers/test-data.mjs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { FileStore, fileKind } from '../bridge/files.mjs';
import { pdfAssets } from '../scripts/pdf-assets.mjs';
const dir = await createTestDirectory('readers-');
const convert = (text, format) => new Promise((resolve, reject) => {
  const child = execFile('/usr/bin/textutil', ['-convert', format, '-format', 'txt', '-stdin', '-stdout', '-encoding', 'UTF-8'], { encoding: 'buffer' }, (error, out) => error ? reject(error) : resolve(out));
  child.stdin.end(text);
});
test('supported file MIME is based on the extension; SVG remains inactive', () => {
  for (const [file, kind] of [['notes.MD','text'], ['proposal.DOCX','word'], ['legacy.doc','word'], ['notes.rtf','word'], ['film.MP4','video'], ['clip.mov','video'], ['film.webm','video'], ['audio.wav','audio'], ['notes.pdf','pdf']]) assert.equal(fileKind(file).kind, kind);
  assert.equal(fileKind('active.svg').kind, 'binary');
  assert.equal(fileKind('report.html').mime, 'text/html');
});
test('Word conversion reads real DOC and DOCX Chinese text without changing source bytes', { skip: process.platform !== 'darwin' }, async () => {
  const text = '产品立项\n这是可直接阅读的中文正文。\n用户问题与下一步验证。\n';
  const store = new FileStore(join(dir, 'word-state'));
  for (const format of ['doc', 'docx', 'rtf']) {
    const bytes = await convert(text, format), source = join(dir, `测试.${format}`);
    await writeFile(source, bytes, { flag: 'wx' });
    const [asset] = await store.importPaths([source]);
    const loaded = await store.get(asset.id);
    assert.equal(loaded.kind, 'word'); assert.ok(loaded.text.includes('可直接阅读的中文正文')); assert.equal(loaded.truncated, false);
    assert.deepEqual(await readFile(source), bytes);
  }
  await assert.rejects(store.get('../auth'));
});
test('older binary media imports are readable without rewriting their metadata or original', async () => {
  const store = new FileStore(join(dir, 'legacy-state'));
  await mkdir(store.root, { recursive: true });
  const id = randomUUID(), bytes = Buffer.from('media-fixture');
  const metadata = JSON.stringify({ id, name: '旧视频.mp4', mime: 'application/octet-stream', kind: 'binary', size: bytes.length });
  await writeFile(join(store.root, `${id}.json`), metadata, { flag: 'wx' });
  await writeFile(join(store.root, `${id}.bin`), bytes, { flag: 'wx' });
  const result = await store.get(id);
  assert.equal(result.kind, 'video'); assert.equal(result.mime, 'video/mp4'); assert.deepEqual(Buffer.from(result.base64, 'base64'), bytes);
  assert.equal(await readFile(join(store.root, `${id}.json`), 'utf8'), metadata);
});
test('text reading extends beyond the old excerpt limit and reports truncation explicitly', async () => {
  const store = new FileStore(join(dir, 'text-state')), source = join(dir, '长文.md');
  const content = '甲'.repeat(1000001);
  await writeFile(source, content, { flag: 'wx' });
  const [asset] = await store.importPaths([source]);
  assert.equal(asset.preview.length, 100000);
  const loaded = await store.get(asset.id);
  assert.equal(loaded.text.length, 1000000); assert.equal(loaded.truncated, true);
  assert.equal((await readFile(source, 'utf8')).length, content.length);
});
test('PDF development route serves the Chinese map bytes and rejects traversal', async () => {
  let middleware;
  pdfAssets().configureServer({ middlewares: { use(route, handler) { assert.equal(route, '/pdf-assets/'); middleware = handler; } } });
  let result, passed = false;
  await middleware({ url: '/cmaps/UniGB-UCS2-H.bcmap?v=1' }, {
    setHeader(name, value) { assert.equal(name, 'Content-Type'); assert.equal(value, 'application/octet-stream'); },
    end(bytes) { result = bytes; },
  }, () => { passed = true; });
  assert.equal(passed, false);
  const require = createRequire(import.meta.url);
  const expected = await readFile(join(dirname(require.resolve('pdfjs-dist/package.json')), 'cmaps/UniGB-UCS2-H.bcmap'));
  assert.deepEqual(result, expected);
  await middleware({ url: '/cmaps/../../package.json' }, { end() { assert.fail('traversal must not be served'); } }, () => { passed = true; });
  assert.equal(passed, true);
});
