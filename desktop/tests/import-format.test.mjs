import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, open, stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestDirectory } from './helpers/test-data.mjs';
import { FileStore } from '../bridge/files.mjs';
import { MAX_FILE_BYTES } from '../bridge/formats.mjs';
import { parseCsv } from '../bridge/csv.mjs';
const dir = await createTestDirectory('import-format-');
test('CSV preserves quoted delimiters, escaped quotes, BOM, CRLF, line breaks and leading zeros', () => {
  const parsed = parseCsv('\uFEFF编号,说明,金额\r\n001,"访谈,第一轮",0\r\n002,"第一行\n第二行 \"\"原话\"\"",12.50\r\n');
  assert.deepEqual(parsed.rows, [['编号','说明','金额'],['001','访谈,第一轮','0'],['002','第一行\n第二行 "原话"','12.50']]);
});
test('CSV auto-detects tab and semicolon without counting quoted separators', () => {
  assert.equal(parseCsv('A;B;C\n1;"x,y,z";3').delimiter, ';');
  assert.deepEqual(parseCsv('编号\t内容\n001\t正文').rows, [['编号','内容'],['001','正文']]);
});
test('CSV drops incomplete truncated rows and caps cells', () => {
  assert.deepEqual(parseCsv('a,b\n1,2\n3,"unfinished', {truncated:true}).rows, [['a','b'],['1','2']]);
  assert.equal(parseCsv('a,b\n1,2\n3,4', {maxCells:4}).limited, true);
});
test('25 MB media imports retain all bytes and metadata queries avoid base64 transport', async () => {
  const source=join(dir,'大文件.mp4'), handle=await open(source,'wx');
  await handle.truncate(25*1024*1024); await handle.write(Buffer.from('suo-media-tail'),0,14,25*1024*1024-14); await handle.close();
  const store=new FileStore(join(dir,'large-state')), [asset]=await store.importPaths([source]);
  assert.equal(asset.size,25*1024*1024); assert.equal(asset.error,undefined);
  assert.equal((await stat(join(store.root,`${asset.id}.bin`))).size,asset.size);
  const copy=await open(join(store.root,`${asset.id}.bin`),'r'), bytes=Buffer.alloc(14); await copy.read(bytes,0,14,asset.size-14); await copy.close();
  assert.equal(bytes.toString(),'suo-media-tail');
  const loaded=await store.get(asset.id,{metadataOnly:true}); assert.equal(loaded.base64,undefined); assert.equal(loaded.kind,'video');
});
test('imports reject files above 200 MB before creating a copy', async () => {
  const source=join(dir,'过大.mp4'), handle=await open(source,'wx'); await handle.truncate(MAX_FILE_BYTES+1); await handle.close();
  const [asset]=await new FileStore(join(dir,'rejected-state')).importPaths([source]);
  assert.match(asset.error,/200 MB/);
});
test('HTML beyond the old 1 million character boundary is retained with head CSS and original bytes', async () => {
  const source=join(dir,'完整样式.html'), text='<!doctype html><html><head><style>h1{color:red}</style></head><body>'+ ' '.repeat(1000010)+'<h1>最后的标题</h1></body></html>';
  await writeFile(source,text,{flag:'wx'}); const store=new FileStore(join(dir,'html-state')), [asset]=await store.importPaths([source]);
  const loaded=await store.get(asset.id); assert.equal(loaded.text,text); assert.equal(loaded.truncated,false);
  assert.equal(await readFile(join(store.root,`${asset.id}.bin`),'utf8'),text);
});

test('CSV retains empty cells and all-empty delimited data rows without numeric coercion', () => {
  assert.deepEqual(parseCsv('编号,金额,备注\n001,12.50,\n,,\n002,0,末行').rows, [['编号','金额','备注'],['001','12.50',''],['','',''],['002','0','末行']]);
});
