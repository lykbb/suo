import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createTestDirectory } from './helpers/test-data.mjs';
import { WorkspaceStore } from '../bridge/store.mjs';
import { FileStore } from '../bridge/files.mjs';
import { Connections } from '../bridge/connections.mjs';
import { prepareHistory, textTokens } from '../bridge/history.mjs';
import { makeContext } from '../bridge/chat.mjs';
import { validateImages } from '../bridge/chat.mjs';
import { extractPdfText } from '../src/pdfText.mjs';

const model = { input: ['text', 'image'], contextWindow: 32768, maxTokens: 4096, api: 'openai-completions', provider: 'fixture', id: 'fixture' };
const image = { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk9sAAAAASUVORK5CYII=' };
const config = () => ({ providers: { fixture: { api: 'openai-completions', baseUrl: 'https://fixture.invalid/v1', apiKey: 'fixture-key', models: [{ id: 'fixture', input: ['text'] }] } } });

test('more than 24 short history turns are carried intact and invalid replies stay excluded', () => {
  const history = Array.from({ length: 60 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', text: '原文' + index }));
  const result = prepareHistory([...history, { role: 'assistant', text: 'fake', demo: true }]);
  assert.equal(result.history.length, 60); assert.equal(result.summarized, 0);
  const context = makeContext({ message: '继续', history, selected: [] }, model);
  assert.equal(context.messages.length, 61); assert.match(JSON.stringify(context), /原文0/);
});
test('long history retains early goals and the latest long reply tail with a visible compression notice', () => {
  const history = [{ role: 'user', text: '目标用户是单人产品经理，预算为零。' }, ...Array.from({ length: 20 }, () => ({ role: 'assistant', text: '历史细节'.repeat(300) })), { role: 'user', text: '最新要求：改成蓝色，保留共享资料。' }, { role: 'assistant', text: '当前方案'.repeat(1900) + '最终需要确认是否发布。' }];
  const original = JSON.stringify(history);
  const result = prepareHistory(history, 20000);
  assert(result.history.length > 0); assert(result.summarized > 0);
  assert.match(result.summary, /单人产品经理/);
  assert.match(JSON.stringify(result.history), /改成蓝色/); assert.match(JSON.stringify(result.history), /最终需要确认/);
  assert(result.history.reduce((sum, item) => sum + textTokens(item.text) + 8, 0) + textTokens(result.summary) <= 20000);
  const context = makeContext({ message: '继续', history, selected: [] }, model);
  assert.match(context.contextNote, /历史消息使用摘记或节选/);
  assert.equal(JSON.stringify(history), original, 'original history is not mutated');
});
test('image MIME and bytes are validated and text-only models make no vision request', () => {
  assert.equal(validateImages([{ image }], model).length, 1);
  assert.throws(() => validateImages([{ image }], { input: ['text'] }), /图片/);
  assert.throws(() => validateImages([{ image: { ...image, mimeType: 'image/jpeg' } }], model), /格式|内容/);
  assert.throws(() => validateImages([{ image: { ...image, data: image.data + '!' } }], model), /图片/);
  assert.throws(() => validateImages(Array.from({ length: 5 }, () => ({ image })), model), /4/);
});
test('a real PDF is parsed into text and included in model context', async () => {
  const phrase = 'Users need fewer manual steps.';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const content = `BT /F1 12 Tf 50 700 Td (${phrase}) Tj ET`;
  objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  let body = '%PDF-1.4\n', offsets = [0];
  objects.forEach((value, index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${value}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(Buffer.from(body)), useSystemFonts: true });
  try {
    const result = await extractPdfText(await task.promise, { signal: new AbortController().signal });
    assert.match(result.text, /Users need fewer manual steps/); assert.equal(result.pages, 1);
    const context = makeContext({ message: '分析资料', selected: [{ title: 'research.pdf', content: result.text }] }, model);
    assert.match(JSON.stringify(context.messages.at(-1)), /Users need fewer manual steps/);
  } finally { await task.destroy(); }
});
// Old versions are the App's own backups: deleted in place, never moved to the user's Trash.
async function trashed(pattern) {
  try { return (await readdir(join(process.env.SUO_TEST_TRASH_ROOT, 'Suo'))).filter(name => pattern.test(name)); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
test('workspace revisions retain 30 valid versions and recover from a corrupt newest version', async () => {
  const root = await createTestDirectory('retention-'), store = new WorkspaceStore(root);
  let state = await store.create();
  for (let index = 0; index < 40; index++) state = await store.save({ ...state, draft: 'v' + index }, state.version);
  const names = (await readdir(store.folder(state.id))).filter(name => name.endsWith('.json'));
  assert.equal(names.length, 30); assert.equal((await store.load(state.id)).draft, 'v39');
  assert.deepEqual(await trashed(/^\d{10}\.json-/u), [], 'pruned versions are not put in the Trash');
  await writeFile(join(store.folder(state.id), '0000000042.json'), '{broken');
  assert.equal((await store.load(state.id)).version, 41);
  const next = await store.save({ ...state, draft: 'after-corruption' }, state.version);
  assert.equal(next.version, 43); assert.equal((await store.load(state.id)).draft, 'after-corruption');
  assert.equal((await readdir(store.folder(state.id))).filter(name => name.endsWith('.json')).length, 31);
});
test('connections retain 3 private committed versions and each configure writes only one', async () => {
  const root = await createTestDirectory('connection-retention-');
  const connections = new Connections({ root, dataRoot: root, fetch: async () => new Response(JSON.stringify({ data: [{ id: 'fixture' }] })) });
  await connections.save(config());
  await connections.configure({ provider: 'fixture', baseUrl: 'https://fixture.invalid/v1', modelId: 'fixture', apiKey: '' });
  assert.equal((await readdir(connections.directory)).filter(name => name.endsWith('.json')).length, 2);
  for (let index = 0; index < 5; index++) await connections.configure({ provider: 'fixture', baseUrl: 'https://fixture.invalid/v1', modelId: 'fixture', apiKey: '' });
  const names = (await readdir(connections.directory)).filter(name => name.endsWith('.json'));
  assert.equal(names.length, 3); assert.equal((await stat(join(connections.directory, names[0]))).mode & 0o777, 0o600);
  assert.deepEqual(await trashed(/^\d{13}-[a-f0-9-]{36}\.json-/u), [], 'old connection files with keys are not put in the Trash');
  await writeFile(join(connections.directory, '9999999999999-' + randomUUID() + '.json'), '{bad');
  assert.equal((await connections.load()).providers.fixture.apiKey, 'fixture-key');
});
test('new URL paths, protocols, API types and failed drafts cannot reuse an old key', async () => {
  const root = await createTestDirectory('key-boundaries-'); let calls = 0;
  const connections = new Connections({ root, dataRoot: root, fetch: async () => { calls++; return new Response('', { status: 401 }); } });
  await connections.save(config());
  for (const change of [{ baseUrl: 'https://fixture.invalid/other' }, { baseUrl: 'http://fixture.invalid/v1' }, { baseUrl: 'https://fixture.invalid/v1', api: 'openai-responses' }]) {
    await assert.rejects(connections.configure({ provider: 'fixture', modelId: 'fixture', apiKey: '', ...change }), /API Key/);
  }
  const draftId = randomUUID();
  await assert.rejects(connections.configure({ draftId, baseUrl: 'https://first.invalid/v1', modelId: 'fixture', apiKey: 'private-draft-key' }));
  const before = calls;
  await assert.rejects(connections.configure({ draftId, baseUrl: 'https://second.invalid/v1', modelId: 'fixture', apiKey: '' }), /API Key/);
  assert.equal(calls, before); assert.equal(before, 1);
});
test('purge uses real attachment paths and protects sharing in older retained revisions', async () => {
  const root = await createTestDirectory('purge-'), store = new WorkspaceStore(root), files = new FileStore(root);
  const source = join(root, 'source.md'); await writeFile(source, 'Shared original');
  const [shared, unique] = await files.importPaths([source, source]);
  const node = asset => ({ id: randomUUID(), position: { x: 0, y: 0 }, data: { kind: 'file', asset } });
  let a = await store.create(), b = await store.create();
  a = await store.save({ ...a, nodes: [node(shared), node(unique)] }, a.version);
  b = await store.save({ ...b, nodes: [node(shared)] }, b.version);
  b = await store.save({ ...b, nodes: [] }, b.version);
  a = await store.remove(a.id, a.version);
  await assert.rejects(store.purge([{ id: a.id, version: a.version - 1 }]), /变化/);
  await assert.rejects(store.purge([{ id: a.id, version: a.version }, { id: a.id, version: a.version }]));
  const result = await store.purge([{ id: a.id, version: a.version }]);
  assert.equal(result.sessionsMoved, 1); assert.equal(result.assetsMoved, 1);
  assert.equal((await files.get(shared.id)).text, 'Shared original');
  await assert.rejects(stat(join(root, 'imports', unique.id + '.bin')), { code: 'ENOENT' });
  await assert.rejects(stat(join(root, 'imports', unique.id + '.json')), { code: 'ENOENT' });
  assert.equal((await store.load(b.id)).nodes.length, 0);
});
test('independent desktop processes cannot both save the same expected revision', async () => {
  const root = await createTestDirectory('process-lock-'), store = new WorkspaceStore(root), state = await store.create();
  const module = new URL('../bridge/store.mjs', import.meta.url).href;
  const run = draft => new Promise((resolve, reject) => {
    const code = `import { WorkspaceStore } from ${JSON.stringify(module)}; const store = new WorkspaceStore(${JSON.stringify(root)}); try { await store.save(${JSON.stringify({ ...state, draft })}, ${state.version}); process.stdout.write('saved'); } catch { process.stdout.write('conflict'); }`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { env: process.env });
    let output = ''; child.stdout.on('data', data => { output += data; }); child.once('error', reject); child.once('exit', code => code ? reject(new Error('child failed')) : resolve(output));
  });
  assert.deepEqual((await Promise.all([run('a'), run('b')])).sort(), ['conflict', 'saved']);
  assert.equal((await store.load(state.id)).version, state.version + 1);
});
