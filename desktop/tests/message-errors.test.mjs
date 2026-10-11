import test from 'node:test';
import assert from 'node:assert/strict';
import { hideSystemRecord, messageDisplayText, presentMessageError, redactErrorDetails } from '../src/messageError.mjs';
import { describeError } from '../bridge/chat.mjs';

test('historical provider errors show a concise Chinese cause while retaining sanitized details', () => {
  const raw = '模型连接失败（HTTP 503：{"error":{"message":"upstream unavailable","request_id":"request-abcdef0123456789"}}）';
  const result = presentMessageError(raw);
  assert.equal(result.kind, 'unavailable');
  assert.equal(result.title, '模型服务暂时不可用');
  assert.doesNotMatch(result.title + result.reason, /HTTP|JSON|request-|503|upstream/u);
  assert.match(result.details, /HTTP 503/);
});

test('structured backend errors and legacy plain errors receive the same actionable presentation', () => {
  for (const value of [JSON.stringify({ status: 401, error: { message: 'invalid_api_key' } }), { statusCode: 401, message: 'Unauthorized' }, '401 Unauthorized', '模型认证失败，请检查 API Key。（HTTP 403：forbidden）']) {
    const result = presentMessageError(value);
    assert.equal(result.kind, 'authentication');
    assert.match(result.reason, /密钥.*权限/);
  }
});

test('a historical Chinese HTTP 503 wrapper preserves the specific model_not_found reason', () => {
  for (const error of [
    { code: 'model_not_found', request_id: 'request-very-long-reference' },
    { code: 'model_not_found', message: 'Unknown model', request_id: 'request-very-long-reference' },
  ]) {
    const result = presentMessageError(`模型连接失败，请检查接口地址、网络和模型配置。（HTTP 503：${JSON.stringify({ error })}）`);
    assert.equal(result.kind, 'model');
    assert.match(result.reason, /模型名称或接口地址/);
    assert.doesNotMatch(result.title + result.reason, /503|model_not_found|request-|HTTP|JSON/u);
  }
});

test('the real backend broad Chinese 429 prefix does not override an explicit provider rate limit', () => {
  const rate = presentMessageError(describeError(new Error('429 rate_limit_exceeded: too many requests')));
  assert.equal(rate.kind, 'rate-limit'); assert.match(rate.reason, /稍等/);
  assert.doesNotMatch(rate.title + rate.reason, /没有可用额度/u);
  const quota = presentMessageError(describeError(new Error('429 insufficient_quota: quota exceeded')));
  assert.equal(quota.kind, 'quota'); assert.match(quota.reason, /额度/);
});

test('the backend response limit explains stopped output instead of a failed connection', () => {
  const result = presentMessageError(describeError(new Error('Response limit')));
  assert.equal(result.kind, 'response-limit');
  assert.match(result.title, /回复太长.*停止接收/);
  assert.match(result.reason, /分段回答/);
  assert.doesNotMatch(result.title + result.reason, /连接|Key|密钥/u);
});

test('plain unknown errors still receive the safe generic presentation', () => {
  for (const raw of ['Unknown', '未知错误']) {
    const result = presentMessageError(raw);
    assert.equal(result.kind, 'unknown');
    assert.equal(result.title, '这次回复没有完成');
  }
});

test('request identifiers containing status numbers are not mistaken for HTTP statuses', () => {
  const result = presentMessageError('Unexpected failure request_id=req-401-failed-404-unknown');
  assert.equal(result.kind, 'unknown');
  assert.doesNotMatch(result.title + result.reason, /req-|Unexpected/u);
});

test('quota, rate limit, model, timeout and network errors explain different remedies', () => {
  const cases = [
    ['HTTP 429 insufficient_quota', 'quota', /额度/],
    ['429 rate_limit_exceeded', 'rate-limit', /稍等/],
    ['404 The model does not exist', 'model', /模型名称/],
    ['ETIMEDOUT connection', 'timeout', /重新试/],
    ['这次任务运行超时（超过 10 分钟），已停止。', 'task-timeout', /拆小/],
    ['TypeError: fetch failed ECONNREFUSED', 'network', /网络/],
    ['还没有配置模型，请在设置中添加模型连接。', 'unconfigured', /添加/],
    ['Context limit', 'context', /拆成/],
    ['当前模型未启用图片能力，请开启图片分析', 'image', /图片/],
    ['模型没有返回文字，请调整问题后重试。', 'empty', /补充/],
  ];
  for (const [raw, kind, remedy] of cases) {
    const result = presentMessageError(raw);
    assert.equal(result.kind, kind, raw); assert.match(result.reason, remedy);
  }
});

test('legacy JSON keys including escaped or spaced values are scrubbed before truncation', () => {
  const secrets = ['old-key-with spaces', 'line\\nsecret', 'opaque-header', 'plain-token'];
  const raw = JSON.stringify({ api_key: secrets[0], apiKey: secrets[1], 'x-api-key': secrets[2], token: secrets[3], message: '认证失败' });
  const details = redactErrorDetails(raw);
  for (const value of secrets) assert(!details.includes(value), value);
  assert.match(details, /认证失败/);
  assert.match(details, /已隐藏/);
});

test('Bearer, Basic, key diagnostics, sk tokens and URL query credentials cannot leak from history', () => {
  const cases = [
    ['Authorization: Bearer historical-bearer-value', 'historical-bearer-value'],
    ['Authorization: Basic dXNlcjpzZWNyZXQ=', 'dXNlcjpzZWNyZXQ='],
    ['Incorrect API key provided: old-custom-secret', 'old-custom-secret'],
    ['x-api-key="custom value with spaces"', 'custom value with spaces'],
    ['secret=plain-secret token=plain-token', 'plain-secret'],
    ['secret=plain-secret token=plain-token', 'plain-token'],
    ['HTTP 401 sk-historical_very_private-key', 'sk-historical_very_private-key'],
    ['https://api.example.test/v1?api_key=query-secret&request_id=keep', 'query-secret'],
    ['https://api.example.test/v1?api%5Fkey=encoded-query-secret', 'encoded-query-secret'],
    ['https://private-user:private-password@api.example.test/v1', 'private-password'],
    ['https://private-user:private-password@api.example.test/v1', 'private-user'],
  ];
  for (const [raw, secret] of cases) assert(!redactErrorDetails(raw).includes(secret), secret);
});

test('large and malformed errors are bounded and harmless without losing the main explanation', () => {
  const raw = `500 unavailable ${'x'.repeat(5000)} API Key: hidden-long-key`;
  const result = presentMessageError(raw);
  assert.equal(result.kind, 'unavailable'); assert(result.details.length < 4100);
  assert(!result.details.includes('hidden-long-key'));
  const circle = {}; circle.self = circle;
  assert.doesNotThrow(() => presentMessageError(circle));
  assert.equal(presentMessageError(undefined).kind, 'unknown');
});

test('a system record a model copied into its reply is never shown, copied or placed on the board', () => {
  const leaked = '画布上只有 2 张空白卡片。\n\n告诉我你的需求。\n\n〔系统记录：这一轮实际执行了〕\n- 查看画布：共 2 张\n  - e2dc21f9 新便签 @597,-463';
  assert.equal(hideSystemRecord(leaked), '画布上只有 2 张空白卡片。\n\n告诉我你的需求。');
  assert.equal(messageDisplayText({ text: leaked }), '画布上只有 2 张空白卡片。\n\n告诉我你的需求。');
  assert.equal(hideSystemRecord('普通回复，提到〔括号〕也不受影响'), '普通回复，提到〔括号〕也不受影响');
});

