import test from 'node:test';
import assert from 'node:assert/strict';
import { publicModels } from '../bridge/connections.mjs';

const config = { providers: { router: { apiKey: 'SECRET_KEY_FIXTURE', baseUrl: 'https://private.example/v1', headers: { Authorization: 'SECRET_HEADER_FIXTURE' }, models: [
  { id: 'alpha', name: 'Alpha', contextWindow: 128000, maxTokens: 8192, apiKey: 'SECRET_MODEL_FIXTURE' },
  { id: 'alpha' }, { id: '' }, { id: 17 }, { id: 'beta', contextWindow: -1, maxTokens: '8192' },
] } } };
test('model catalog returns public metadata and strips provider and model credentials', () => {
  const models = publicModels(config);
  assert.equal(models.length, 2);
  assert.deepEqual(models[0], { provider: 'router', id: 'alpha', name: 'Alpha', contextWindow: 128000, maxTokens: 8192, supportsImages: false });
  assert.equal(models[1].contextWindow, undefined);
  assert.equal(models[1].maxTokens, undefined);
  assert.doesNotMatch(JSON.stringify(models), /SECRET|private.example|apiKey|Authorization/);
});
