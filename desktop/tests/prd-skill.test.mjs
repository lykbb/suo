import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const engine = process.env.SUO_SKILL_TEST_ENGINE ?? fileURLToPath(new URL('../../', import.meta.url));
const source = process.env.SUO_SKILL_TEST_ROOT ?? engine;
const { SkillLibrary } = await import(pathToFileURL(join(engine, 'desktop/bridge/skills.mjs')));
const { createTools } = await import(pathToFileURL(join(engine, 'desktop/bridge/agent.mjs')));
const { makeContext, loadAgentInstructions } = await import(pathToFileURL(join(engine, 'desktop/bridge/chat.mjs')));
const { runtimeResources, copyRuntimeResources } = await import(pathToFileURL(join(engine, 'desktop/scripts/runtime-resources.mjs')));
const { createTestDirectory } = await import(pathToFileURL(join(engine, 'desktop/tests/helpers/test-data.mjs')));
const skills = new SkillLibrary({ builtinRoot: join(source, 'skills'), writableRoot: join(source, 'skills') });
const sha = text => createHash('sha256').update(text).digest('hex');

test('toolbox registry exposes separate requirements and PRD entries with attribution', async () => {
  const listed = await skills.list();
  const requirements = listed.filter(skill => skill.name === 'pm-requirements-prd');
  const prd = listed.filter(skill => skill.name === 'pm-prd');
  assert.equal(requirements.length, 1); assert.equal(prd.length, 1);
  assert.equal(requirements[0].title, '需求拆解'); assert.equal(prd[0].title, 'PRD');
  assert(prd[0].description.includes('a15242408085-bot'));
  assert.equal(new Set(listed.map(skill => skill.name)).size, listed.length);
});

test('Agent use_skill reads the PRD body and its complete template through existing tools', async () => {
  let uiCalls = 0;
  const tool = createTools({ skillsRoot: skills, ui: async () => { uiCalls++; } }).find(tool => tool.name === 'use_skill');
  const loaded = await tool.execute('prd-method', { name: 'pm-prd' });
  assert(loaded.content[0].text.includes((await skills.get('pm-prd')).body));
  const template = await tool.execute('prd-template', { name: 'pm-prd', file: 'assets/prd-template.md' });
  assert.equal(sha(template.content[0].text.split('\n\n').slice(1).join('\n\n')), sha((await skills.read('pm-prd', 'assets/prd-template.md')).text));
  assert.equal(uiCalls, 0);
});

test('upstream PRD body and template retain the pinned source content', async () => {
  const detail = await skills.get('pm-prd');
  const original = detail.body.slice(detail.body.indexOf('# 写可验收的 PRD')).trim();
  assert.equal(sha(original), '79e5b281b3afbab696b26c7837f27eba09f61df3121efad2348ff853997b0e7b');
  assert.equal(sha((await skills.read('pm-prd', 'assets/prd-template.md')).text), 'f069ac22c0efc5b32d2a20b5386e27caa96e8b9eefc16efff5947b991cec4847');
  const license = await skills.read('pm-prd', 'references/license.md');
  assert(license.text.includes('Copyright (c) 2026 a15242408085-bot'));
});

test('all local resource links resolve through the same skill library the Agent uses', async () => {
  const detail = await skills.get('pm-prd');
  const documents = [{ path: 'SKILL.md', content: detail.body }, ...detail.files];
  for (const document of documents) {
    for (const match of document.content.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)) {
      const path = match[1];
      if (/^(?:https?:|#)/u.test(path)) continue;
      const resolved = posix.normalize(posix.join(posix.dirname(document.path), path));
      const resource = await skills.read('pm-prd', resolved);
      assert(resource.text.trim(), `${document.path} -> ${resolved}`);
    }
  }
  const requirements = await skills.get('pm-requirements-prd');
  assert.equal(requirements.files.length, 0, 'formal PRD references live in the independent PRD skill');
});

test('fresh chat context discovers both methods without preloading full PRD instructions', async () => {
  const listed = await skills.list(), role = await loadAgentInstructions(source);
  const context = makeContext({ workspaceId: 'prd-skill-test', message: '写 PRD', selected: [], history: [] },
    { input: ['text'], contextWindow: 32768 }, listed, role);
  for (const name of ['pm-requirements-prd', 'pm-prd']) assert(context.systemPrompt.includes(`- ${name}：`));
  assert(!context.systemPrompt.includes('# 写可验收的 PRD'));
});

test('packaging retains both skill entries, attribution, license, and all referenced text', async () => {
  const folder = await createTestDirectory('prd-resources-'), runtime = join(folder, 'runtime');
  const original = await runtimeResources(source), copied = await copyRuntimeResources(source, runtime);
  assert.equal(copied.digest, original.digest); assert.equal((await runtimeResources(runtime)).digest, original.digest);
  const packaged = new SkillLibrary({ builtinRoot: join(runtime, 'skills'), writableRoot: join(runtime, 'skills') });
  for (const name of ['pm-requirements-prd', 'pm-prd']) {
    const expected = await skills.get(name), actual = await packaged.get(name);
    assert.equal(actual.body, expected.body); assert.deepEqual(actual.files, expected.files);
  }
});
