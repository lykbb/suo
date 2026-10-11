import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JsonLines } from '../bridge/rpc.mjs';

test('JSONL handles split chunks, CRLF and Unicode separators inside strings', () => {
  const records = [], reader = new JsonLines(record => records.push(record));
  const line = JSON.stringify({ text: '你\u2028好\u2029呀' }) + '\r\n';
  reader.push(line.slice(0, 8)); reader.push(line.slice(8) + '{"id":2}\n');
  assert.deepEqual(records, [{ text: '你\u2028好\u2029呀' }, { id: 2 }]);
});
test('host answers known requests and rejects the removed demo reply and shell commands', async () => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../bridge/host.mjs', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'] });
  const awaiting = new Map(); let seq = 0;
  child.stdout.setEncoding('utf8');
  const reader = new JsonLines(record => { if (record.id && awaiting.has(record.id)) { awaiting.get(record.id)(record); awaiting.delete(record.id); } });
  child.stdout.on('data', chunk => reader.push(chunk));
  const call = (method, payload = {}) => new Promise(resolve => { const id = String(++seq); awaiting.set(id, resolve); child.stdin.write(JSON.stringify({ id, method, payload }) + '\n'); });
  try {
    assert.ok((await call('workspace.create')).result.id);
    assert.equal((await call('prompt.abort')).result.stopped, false);
    assert.match((await call('prompt.mock', { workspaceId: 'test', message: '你好' })).error, /未知/);
    assert.match((await call('bash', { command: 'echo fail' })).error, /未知/);
  } finally { child.stdin.end(); await new Promise(resolve => child.once('exit', resolve)); }
});
