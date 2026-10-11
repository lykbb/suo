import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDirectory } from './helpers/test-data.mjs';
import { join } from 'node:path';
import { Connections, connectionCatalog } from '../bridge/connections.mjs';

const config = () => ({ providers: { router: { api: 'openai-completions', baseUrl: 'https://router.example.test/v1', apiKey: 'private-fixture-token', models: [{ id: 'wrong-id', name: 'wrong-id' }, { id: 'sibling', name: 'sibling' }] } }, selected: { provider: 'router', id: 'sibling' } });
const models = async () => new Response(JSON.stringify({ data: [{ id: 'correct-id' }, { id: 'sibling' }] }));
async function fixture(fetch = models) {
  const dataRoot = await createTestDirectory('model-records-');
  const connections = new Connections({ root: join(dataRoot, 'unused-engine'), dataRoot, fetch });
  await connections.save(config());
  return { connections, dataRoot };
}
test('editing a wrong model identifier replaces that record and keeps sibling models', async () => {
  const { connections } = await fixture();
  await connections.configure({ provider: 'router', editModelId: 'wrong-id', baseUrl: 'https://router.example.test/v1', modelId: 'correct-id', apiKey: '' });
  const saved = await connections.load();
  assert.deepEqual(saved.providers.router.models.map(item => item.id), ['sibling', 'correct-id']);
  assert.equal(saved.providers.router.apiKey, 'private-fixture-token');
  assert.equal(saved.providers.router.models[1].name, 'correct-id');
});
test('changing the endpoint requires a fresh key before any network request', async () => {
  let calls = 0;
  const { connections } = await fixture(async () => { calls++; return models(); });
  await assert.rejects(connections.configure({ provider: 'router', editModelId: 'wrong-id', baseUrl: 'https://new.example.test/v1', modelId: 'correct-id', apiKey: '' }), /API Key/);
  assert.equal(calls, 0);
  const before = await connections.load();
  assert.equal(before.providers.router.baseUrl, 'https://router.example.test/v1');
  assert.equal(Object.values(before.drafts)[0].apiKey, '');
  await connections.configure({ provider: 'router', editModelId: 'wrong-id', baseUrl: 'https://new.example.test/v1', modelId: 'correct-id', apiKey: 'new-address-fixture-key' });
  const saved = await connections.load();
  assert.equal(saved.providers.router.baseUrl, 'https://new.example.test/v1');
  assert.equal(saved.providers.router.models.length, 2);
  assert.equal(saved.providers.router.apiKey, 'new-address-fixture-key');
});
test('a rejected key keeps an editable private draft across restarts without changing active connections or revealing the key', async () => {
  const { connections, dataRoot } = await fixture(async () => new Response('', { status: 401 }));
  const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  await assert.rejects(connections.configure({ draftId: id, baseUrl: 'https://bad.example.test/v1', modelId: 'wrong', apiKey: 'bad-private-fixture' }), /草稿已保留/);
  const reopened = new Connections({ root: join(dataRoot, 'unused-engine'), dataRoot, fetch: models });
  const saved = await reopened.load(), catalog = await reopened.list();
  assert.equal(saved.providers.router.apiKey, 'private-fixture-token');
  assert.deepEqual(saved.selected, config().selected);
  assert.equal(saved.drafts[id].apiKey, 'bad-private-fixture');
  assert.equal(catalog.drafts[0].modelId, 'wrong'); assert.equal(catalog.drafts[0].hasKey, true);
  assert.doesNotMatch(JSON.stringify(catalog), /bad-private-fixture|private-fixture-token|apiKey/);
});
test('correcting a failed draft reuses its stored key, activates the corrected model and removes the draft', async () => {
  const { connections } = await fixture();
  const id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  await assert.rejects(connections.configure({ draftId: id, baseUrl: 'https://other.example.test/v1', modelId: 'typo', apiKey: 'draft-private-token' }));
  await connections.configure({ draftId: id, baseUrl: 'https://other.example.test/v1', modelId: 'correct-id', apiKey: '' });
  const saved = await connections.load();
  assert.equal(saved.drafts, undefined);
  assert.equal(saved.providers[saved.selected.provider].apiKey, 'draft-private-token');
  assert.equal(saved.selected.id, 'correct-id'); assert(saved.providers.router);
});
test('an invalid endpoint remains editable as a draft and never becomes an active provider', async () => {
  const { connections } = await fixture();
  await assert.rejects(connections.configure({ baseUrl: 'missing-protocol', modelId: 'correct-id', apiKey: 'fixture-token' }), /地址格式不正确/);
  const catalog = await connections.list();
  assert.equal(catalog.drafts[0].baseUrl, 'missing-protocol'); assert.equal(catalog.connections.length, 1);
});
test('draft addresses keep credentials private even when an invalid URL cannot be parsed', async () => {
  for (const baseUrl of ['https://fixture-user:fixture-password@example.test/v1?api_key=fixture-query#fixture-fragment', 'https://fixture-user:fixture-password@invalid host/v1?api_key=fixture-query#fixture-fragment']) {
    const { connections } = await fixture();
    await assert.rejects(connections.configure({ baseUrl, modelId: 'correct-id', apiKey: 'fixture-token' }));
    const saved = await connections.load(), catalog = await connections.list();
    assert.equal(Object.values(saved.drafts)[0].baseUrl, baseUrl);
    assert.doesNotMatch(JSON.stringify(catalog), /fixture-user|fixture-password|fixture-query|fixture-fragment|fixture-token|apiKey/);
    assert.equal(catalog.connections.length, 1);
    assert.match(catalog.drafts[0].baseUrl, /\/v1$/);
  }
});
test('renaming a model to an existing sibling is rejected without merging or losing either record', async () => {
  const { connections } = await fixture();
  await assert.rejects(connections.configure({ provider: 'router', editModelId: 'wrong-id', baseUrl: 'https://router.example.test/v1', modelId: 'sibling', apiKey: '' }), /已经有记录/);
  const saved = await connections.load();
  assert.deepEqual(saved.providers.router.models.map(item => item.id), ['wrong-id', 'sibling']);
  assert.doesNotMatch(JSON.stringify(connectionCatalog(saved)), /private-fixture-token/);
});
test('successive saves in the same millisecond always load the last version', async () => {
  const now = Date.now;
  try {
    Date.now = () => 1790000000000;
    const { connections } = await fixture();
    for (let index = 0; index < 4; index++) await connections.save({ ...config(), selected: { provider: 'router', id: index === 3 ? 'wrong-id' : 'sibling' } });
    assert.equal((await connections.load()).selected.id, 'wrong-id');
  } finally { Date.now = now; }
});
