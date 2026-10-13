import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

function moduleCode(file, source) {
  const ast = ts.createSourceFile(String(file), source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  return ts.transpileModule(ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
}
const file = new URL('../src/ModelSettings.tsx', import.meta.url);
const code = moduleCode(file, await readFile(file, 'utf8'));
const presetsFile = process.env.SUO_MODEL_PRESETS_SOURCE ?? new URL('../src/modelPresets.ts', import.meta.url);
const presets = { exports: {}, URL };
vm.runInNewContext(moduleCode(presetsFile, await readFile(presetsFile, 'utf8')), presets);
const { PRESETS, presetFor, recommendedModel } = presets.exports;
function harness() {
  const slots = [], effects = [], requests = []; let cursor = 0, mounted = false;
  const jsx = (type, props) => ({ type, props });
  const context = { exports: {}, URL, Error, Map, Event: class {}, crypto: { randomUUID: () => 'draft-test' },
    PRESETS, presetFor, recommendedModel, native: false, openExternal: () => Promise.resolve(),
    chooseModelConfig: () => Promise.resolve(), update: () => {}, window: { dispatchEvent() {} },
    app: { use: callback => callback({ busy: false }) },
    useState(initial) {
      const index = cursor++; if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(effect) { cursor++; if (!mounted) effects.push(effect); },
    request(method, payload) {
      if (method === 'models.list') return Promise.resolve({ models: [], connections: [], drafts: [] });
      assert.equal(method, 'models.discover');
      let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      requests.push({ payload, resolve, reject }); return promise;
    },
    require(name) { assert.equal(name, 'react/jsx-runtime'); return { jsx, jsxs: jsx, Fragment: Symbol('Fragment') }; },
  };
  vm.runInNewContext(code, context); const component = context.exports.default;
  const render = () => { cursor = 0; const tree = component(); mounted = true; return tree; };
  function elements(node) { if (!node || typeof node !== 'object') return []; return [node, ...[node.props?.children].flat(Infinity).flatMap(elements)]; }
  const all = () => elements(render());
  const key = () => all().find(node => node.type === 'input' && node.props.type === 'password');
  const pick = id => all().find(node => node.type === 'button' && node.props.role === 'radio' && node.props.children === PRESETS.find(item => item.id === id)?.name).props.onClick();
  const status = () => all().find(node => node.type === 'span' && node.props.role === 'status')?.props.children;
  const discover = () => all().find(node => node.type === 'button' && ['读取可用型号', '重新读取型号'].includes(node.props.children)).props.onClick();
  const setKey = value => key().props.onChange({ target: { value } });
  const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
  render(); const cleanup = effects.map(effect => effect());
  return { all, key, pick, status, discover, setKey, requests, tick, cleanup,
    modelIds: () => all().filter(node => node.type === 'option').map(node => node.props.value) };
}

test('switching providers clears the typed key and does not send it to the new endpoint', async () => {
  const h = harness(); await h.tick();
  h.setKey('fake-old-provider-key'); h.pick(PRESETS[1].id);
  assert.equal(h.key().props.value, ''); assert.equal(h.requests.length, 0);
  h.setKey('fake-new-provider-key'); h.discover();
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].payload.baseUrl, PRESETS[1].baseUrl);
  assert.equal(h.requests[0].payload.apiKey, 'fake-new-provider-key');
  h.requests[0].resolve({ models: ['new-provider-model'] }); await h.tick();
  assert.ok(h.modelIds().includes('new-provider-model'));
});

test('an old provider result never overwrites the new provider model list', async () => {
  const h = harness(); await h.tick(); h.setKey('fake-first-key'); h.discover();
  const first = h.requests[0]; h.pick(PRESETS[1].id); h.setKey('fake-second-key'); h.discover();
  const second = h.requests[1]; second.resolve({ models: ['second-model'] }); await h.tick();
  first.resolve({ models: ['first-model'] }); await h.tick();
  assert.ok(h.modelIds().includes('second-model')); assert.ok(!h.modelIds().includes('first-model'));
});

test('an obsolete failure cannot clear a newer list or end its pending indicator', async () => {
  const h = harness(); await h.tick(); h.setKey('fake-one'); h.discover(); const first = h.requests[0];
  h.setKey('fake-two'); h.discover(); const second = h.requests[1];
  first.reject(new Error('old request failed')); await h.tick();
  assert.equal(h.status(), '正在读取可用型号…');
  second.resolve({ models: ['current-model'] }); await h.tick(); assert.ok(h.modelIds().includes('current-model'));
});

test('editing the address or API type clears the typed key and invalidates pending results', async () => {
  const h = harness(); await h.tick();
  const custom = h.all().find(node => node.type === 'button' && node.props.children === '自定义'); custom.props.onClick();
  const urlInput = () => h.all().find(node => node.type === 'input' && node.props.placeholder === 'https://api.example.com/v1');
  urlInput().props.onChange({ target: { value: 'https://one.example/v1' } }); h.setKey('fake-address-key'); h.discover();
  urlInput().props.onChange({ target: { value: 'https://two.example/v1' } }); assert.equal(h.key().props.value, '');
  h.requests[0].resolve({ models: ['obsolete-address-model'] }); await h.tick(); assert.ok(!h.modelIds().includes('obsolete-address-model'));
  h.setKey('fake-kind-key'); const kind = h.all().find(node => node.type === 'select' && node.props.value === 'openai-completions');
  kind.props.onChange({ target: { value: 'anthropic-messages' } }); assert.equal(h.key().props.value, '');
});

test('unmounting invalidates a pending response without changing the form state', async () => {
  const h = harness(); await h.tick(); h.setKey('fake-key'); h.discover();
  h.cleanup.forEach(fn => fn?.()); const before = h.status(); h.requests[0].resolve({ models: ['late-model'] }); await h.tick();
  assert.equal(h.status(), before); assert.ok(!h.modelIds().includes('late-model'));
});
