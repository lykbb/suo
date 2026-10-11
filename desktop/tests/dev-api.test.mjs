import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestDirectory } from './helpers/test-data.mjs';
import { devApi } from '../bridge/dev-api.mjs';

test('local API rejects missing nonce, foreign origin/host and unlisted methods', async () => {
  let handler;
  const httpServer = createServer((req, res) => { req.url = req.url.replace(/^\/__suo/u, ''); void handler(req, res); });
  const data = await createTestDirectory('dev-api-');
  await mkdir(join(data, 'agent'));
  await writeFile(join(data, 'agent/models.json'), JSON.stringify({ providers: { fixture: { api: 'openai-completions', baseUrl: 'https://fixture.invalid/v1', apiKey: 'fake-only-fixture-key', models: [{ id: 'fixture' }] } } }));
  process.env.SUO_DESKTOP_DATA = data; process.env.SUO_DESKTOP_ENGINE = join(data, 'unused-engine');
  const plugin = devApi(), token = plugin.transformIndexHtml()[0].attrs.content;
  plugin.configureServer({ httpServer, middlewares: { use(_path, fn) { handler = fn; } } });
  await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  const port = httpServer.address().port, origin = 'http://127.0.0.1:' + port;
  const call = (extra = {}, method = 'models.list') => new Promise((resolve, reject) => {
    const body = JSON.stringify({ method, payload: {} });
    const req = request({ host: '127.0.0.1', port, path: '/__suo/request', method: 'POST', headers: { Origin: origin, 'X-Suo-Token': token, 'Content-Type': 'application/json', ...extra } }, res => {
      const parts = []; res.on('data', part => parts.push(part)); res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(parts).toString() }));
    });
    req.on('error', reject); req.end(body);
  });
  try {
    assert.equal((await call({ 'X-Suo-Token': '' })).status, 403);
    assert.equal((await call({ Origin: 'https://untrusted.invalid' })).status, 403);
    assert.equal((await call({ Host: 'untrusted.invalid' })).status, 403);
    assert.equal((await call({ Origin: '' })).status, 403);
    assert.equal((await call({}, 'native.import')).status, 403);
    assert.equal((await call({}, 'prompt.mock')).status, 403);
    const good = await call(); assert.equal(good.status, 200);
    // The same loopback server opened as localhost works too.
    assert.equal((await call({ Host: 'localhost:' + port, Origin: 'http://localhost:' + port })).status, 200);
    assert.equal((await call({ Host: 'localhost:' + port })).status, 403);
    const catalog = JSON.parse(good.text).result;
    assert(Array.isArray(catalog.models)); assert(!/apiKey|authorization/iu.test(good.text));
  } finally { httpServer.closeAllConnections(); await new Promise(resolve => httpServer.close(resolve)); }
});
