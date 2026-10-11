import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestDirectory } from './helpers/test-data.mjs';
import { FileStore, fileKind } from '../bridge/files.mjs';

test('import preserves source bytes and provides real text preview', async () => {
  const dir = await createTestDirectory('files-'), source = join(dir, '访谈.md');
  const text = '# 访谈\n最近一次遇到困难是什么时候？';
  await writeFile(source, text, { flag: 'wx' });
  const store = new FileStore(join(dir, 'state'));
  const [asset] = await store.importPaths([source]);
  assert.equal(asset.preview, text);
  assert.equal((await store.get(asset.id)).text, text);
  assert.equal(await readFile(source, 'utf8'), text);
  await assert.rejects(store.get('../auth'));
});
test('unsupported formats stay binary and folder import reports an error', async () => {
  assert.equal(fileKind('active.svg').kind, 'binary');
  assert.equal(fileKind('report.HTML').kind, 'html');
  assert.equal(fileKind('report.pdf').kind, 'pdf');
  const dir = await createTestDirectory('folder-');
  const [result] = await new FileStore(join(dir, 'state')).importPaths([dir]);
  assert.match(result.error, /文件夹/);
});
