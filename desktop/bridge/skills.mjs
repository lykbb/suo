import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { lockedSerial } from './queue.mjs';

const { parseDocument } = createRequire(join(process.env.SUO_DESKTOP_ENGINE ?? resolve(dirname(fileURLToPath(import.meta.url)), '../..'), 'package.json'))('yaml');

const MAX_FILE = 400 * 1024, MAX_TOTAL = 2 * 1024 * 1024, MAX_FILES = 64;
const TEXT_FILE = /\.(md|txt|json|csv|ya?ml|html?|css|py|[cm]?js|ts|sh)$/iu;
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const REVISION = /^[a-f0-9]{64}$/u;
const missing = error => error?.code === 'ENOENT';
const hash = text => createHash('sha256').update(text).digest('hex');
const contained = (root, path) => { const child = relative(root, path); return child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child); };

function plain(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f]/u.test(value)) throw new Error(`请填写有效的${label}。`);
  return value.trim();
}
function bodyText(value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || Buffer.byteLength(value) > MAX_FILE) throw new Error('请填写技能或模板正文，最多 400 KiB。');
  return value.replace(/\r\n/gu, '\n').trim();
}
function skillName(value) {
  if (typeof value !== 'string' || value.length > 64 || !SKILL_NAME.test(value)) throw new Error('技能名称只能用小写英文字母、数字和连字符，最多 64 个字符。');
  return value;
}
function fileName(value) {
  if (typeof value !== 'string' || value.length > 220 || value.includes('\\') || isAbsolute(value)) throw new Error('参考文件路径无效。');
  const parts = value.split('/');
  if (parts.length > 6 || parts.some(part => !part || part === '.' || part === '..' || part.startsWith('.') || /[\x00-\x1f]/u.test(part)) || !TEXT_FILE.test(value) || value.toLowerCase() === 'skill.md') throw new Error('参考文件只能放在技能目录内，使用文本文件。');
  return value;
}
function normalizeFiles(values = []) {
  if (!Array.isArray(values) || values.length > MAX_FILES) throw new Error('一个技能最多添加 64 个参考文件。');
  const files = values.map(file => {
    const path = fileName(file?.path), content = file?.content;
    if (typeof content !== 'string' || content.includes('\0') || Buffer.byteLength(content) > MAX_FILE) throw new Error('参考文件必须是文本，每份最多 400 KiB。');
    return { path, content };
  }).sort((a, b) => a.path.localeCompare(b.path));
  if (new Set(files.map(file => file.path.toLowerCase())).size !== files.length) throw new Error('参考文件路径不能重复。');
  if (files.some(file => files.some(other => file !== other && other.path.toLowerCase().startsWith(file.path.toLowerCase() + '/')))) throw new Error('参考文件和文件夹路径不能重名。');
  return files;
}
export function parseSkillMarkdown(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_FILE || text.includes('\0')) throw new Error('SKILL.md 必须是文本，最多 400 KiB。');
  const match = text.replace(/^\uFEFF/u, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/u);
  if (!match) throw new Error('SKILL.md 需要包含 name 和 description 的开头信息。');
  let metadata;
  try {
    const document = parseDocument(match[1], { prettyErrors: false, uniqueKeys: true, schema: 'failsafe' });
    if (document.errors.length) throw document.errors[0];
    metadata = document.toJS({ maxAliasCount: 20 });
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('开头信息需要是键值格式。');
    for (const key of ['name', 'description', 'display_name']) if (metadata[key] !== undefined && typeof metadata[key] !== 'string') throw new Error(`${key} 必须是文字。`);
  } catch { throw new Error('SKILL.md 开头信息格式无效，请检查 name、description 和 YAML 缩进。'); }
  return { name: metadata.name, title: metadata.display_name || metadata.name, description: typeof metadata.description === 'string' ? metadata.description.replace(/\s+/gu, ' ').trim() : metadata.description, body: match[2].trim(), managed: metadata.suo_managed === 'true' };
}
function markdown(value) {
  return `---\nname: ${value.name}\ndisplay_name: ${JSON.stringify(value.title)}\ndescription: ${JSON.stringify(value.description)}\nsuo_managed: true\n---\n\n${value.body}\n`;
}
async function directoryInfo(path, { optional = false } = {}) {
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== resolve(path)) throw new Error('技能或模板目录不能通过软链接指向其他位置。');
    return true;
  } catch (error) { if (optional && missing(error)) { let parent = dirname(path); while (parent !== dirname(parent)) { try { const info = await lstat(parent); if (!info.isDirectory() || info.isSymbolicLink() || await realpath(parent) !== resolve(parent)) throw new Error('保存目录不能通过软链接指向其他位置。'); break; } catch (failure) { if (!missing(failure)) throw failure; parent = dirname(parent); } } return false; } throw error; }
}
async function checkedText(folder, path) {
  const target = resolve(folder, path);
  if (!contained(folder, target) || target === folder || !TEXT_FILE.test(path)) throw new Error('只能读取该技能目录里的文本文件。');
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink() || !contained(await realpath(folder), await realpath(target))) throw new Error('技能参考文件不能是软链接。');
  if (info.size > MAX_FILE) throw new Error('这个技能文件太大。');
  const content = await readFile(target, 'utf8');
  if (content.includes('\0')) throw new Error('技能参考文件必须是文本。');
  return content;
}
async function referenceFiles(folder, prefix = '', depth = 0) {
  const found = [];
  for (const entry of await readdir(join(folder, prefix), { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory() && depth < 5) found.push(...await referenceFiles(folder, path, depth + 1));
    else if (entry.isFile() && path !== 'SKILL.md' && TEXT_FILE.test(path)) found.push(path);
    if (found.length > MAX_FILES) throw new Error('技能参考文件超过 64 份。');
  }
  return found.sort((a, b) => a.localeCompare(b));
}
async function readFolder(folder) {
  await directoryInfo(folder);
  const text = await checkedText(folder, 'SKILL.md'), parsed = parseSkillMarkdown(text);
  skillName(parsed.name); plain(parsed.title, '技能标题', 100); plain(parsed.description, '技能简介', 1000); bodyText(parsed.body);
  const files = [];
  for (const path of await referenceFiles(folder)) files.push({ path, content: await checkedText(folder, path) });
  if (Buffer.byteLength(text) + files.reduce((sum, file) => sum + Buffer.byteLength(file.content), 0) > MAX_TOTAL) throw new Error('一个技能包最多 2 MiB。');
  return { ...parsed, text, files, revision: hash(JSON.stringify({ text, files })) };
}
function summary(record, folder, editable) {
  return { name: record.name, title: record.title, description: record.description, folder, source: editable ? 'custom' : 'builtin', editable, revision: record.revision };
}
async function scan(root) {
  if (!await directoryInfo(root, { optional: true })) return [];
  const result = [];
  for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    try { result.push({ folder: entry.name, root, record: await readFolder(join(root, entry.name)) }); }
    catch (error) { if (!missing(error)) continue; }
  }
  return result;
}
async function atomicText(path, text, create = false) {
  const pending = join(dirname(path), `.pending-${randomUUID()}`), handle = await open(pending, 'wx', 0o600);
  try { await handle.writeFile(text, 'utf8'); await handle.sync(); } finally { await handle.close(); }
  try {
    if (create) { const { link } = await import('node:fs/promises'); await link(pending, path); await unlink(pending); }
    else await rename(pending, path);
  } catch (error) { await unlink(pending).catch(() => {}); throw error; }
}
function checkRevision(current, expected, label) {
  if (current) {
    if (expected !== current) throw new Error(`${label}已被另一个窗口更新，请重新打开后保存。`);
  } else if (expected != null) throw new Error(`${label}不存在，请重新添加。`);
}

export class SkillLibrary {
  constructor({ builtinRoot, writableRoot }) { this.builtinRoot = resolve(builtinRoot); this.writableRoot = resolve(writableRoot); }
  async records() {
    const builtins = await scan(this.builtinRoot);
    const custom = this.writableRoot === this.builtinRoot ? [] : await scan(this.writableRoot);
    const names = new Set(), result = [];
    for (const value of [...builtins, ...custom]) {
      if (names.has(value.record.name)) continue;
      names.add(value.record.name);
      const editable = value.root === this.writableRoot && value.record.managed;
      result.push({ ...value, skill: summary(value.record, value.folder, editable) });
    }
    return result;
  }
  async list() { return (await this.records()).map(value => value.skill); }
  async find(name) {
    if (typeof name !== 'string' || name.length > 100) throw new Error('技能名称无效。');
    const record = (await this.records()).find(value => value.record.name === name || value.folder === name);
    if (!record) throw new Error(`没有名为「${name}」的技能。`);
    return record;
  }
  async get(name) { const value = await this.find(name); return { skill: value.skill, body: value.record.body, files: value.record.files }; }
  async read(name, file = 'SKILL.md') {
    const value = await this.find(name);
    if (file !== 'SKILL.md') fileName(file);
    const text = file === 'SKILL.md' ? value.record.text : value.record.files.find(item => item.path === file)?.content;
    if (text === undefined) throw new Error('没有找到该技能的参考文件。');
    return { skill: value.skill, file, text, files: file === 'SKILL.md' ? value.record.files.map(item => item.path) : [] };
  }

  parse(payload) {
    if (!Array.isArray(payload?.files) || !payload.files.length || payload.files.length > MAX_FILES + 1) throw new Error('请选择一个 SKILL.md 或含有它的技能文件夹。');
    const files = payload.files;
    const primary = files.filter(file => file?.path === 'SKILL.md');
    if (primary.length !== 1) throw new Error('技能包根目录需要且只能有一个 SKILL.md。');
    const parsed = parseSkillMarkdown(primary[0].content);
    const name = skillName(parsed.name), title = plain(parsed.title || name, '技能标题', 100), description = plain(parsed.description, '技能简介', 1000), body = bodyText(parsed.body);
    const references = normalizeFiles(files.filter(file => file.path !== 'SKILL.md'));
    if (Buffer.byteLength(primary[0].content) + references.reduce((sum, file) => sum + Buffer.byteLength(file.content), 0) > MAX_TOTAL) throw new Error('一个技能包最多 2 MiB。');
    return { name, title, description, body, files: references };
  }
  async save(payload) {
    const name = skillName(payload?.name), title = plain(payload?.title || name, '技能标题', 100), description = plain(payload?.description, '技能简介', 1000), body = bodyText(payload?.body);
    const files = payload.files === undefined ? undefined : normalizeFiles(payload.files);
    await directoryInfo(this.writableRoot, { optional: true });
    return lockedSerial(this.writableRoot, async () => {
      await directoryInfo(this.writableRoot);
      const records = await this.records(), current = records.find(value => value.record.name === name || value.folder === name);
      if (current && !current.skill.editable) throw new Error('内置技能保持原样，请换一个名称添加自己的技能。');
      checkRevision(current?.record.revision, payload.expectedRevision, '技能');
      const finalFiles = files ?? current?.record.files ?? [];
      if (current && JSON.stringify(finalFiles) !== JSON.stringify(current.record.files)) throw new Error('编辑会保留已导入的参考文件；参考文件有变化时请作为新技能导入。');
      const text = markdown({ name, title, description, body });
      if (Buffer.byteLength(text) > MAX_FILE) throw new Error('SKILL.md 正文和开头信息合计最多 400 KiB。');
      if (Buffer.byteLength(text) + finalFiles.reduce((sum, file) => sum + Buffer.byteLength(file.content), 0) > MAX_TOTAL) throw new Error('一个技能包最多 2 MiB。');
      if (current) {
        const folder = join(this.writableRoot, current.folder);
        await directoryInfo(folder);
        const checked = await readFolder(folder); checkRevision(checked.revision, payload.expectedRevision, '技能');
        await atomicText(join(folder, 'SKILL.md'), text);
      } else {
        const destination = join(this.writableRoot, name);
        try { await lstat(destination); throw new Error('这个技能文件夹已存在，请换一个名称。'); } catch (error) { if (!missing(error)) throw error; }
        const stage = join(this.writableRoot, `.pending-${randomUUID()}`);
        await mkdir(stage, { mode: 0o700 });
        await atomicText(join(stage, 'SKILL.md'), text, true);
        for (const file of finalFiles) { const path = join(stage, file.path); await mkdir(dirname(path), { recursive: true, mode: 0o700 }); await atomicText(path, file.content, true); }
        await rename(stage, destination);
      }
      return this.get(name);
    });
  }
}

const TEMPLATE_ID = /^[a-f0-9-]{36}$/u;
function templateSummary(value) { return { id: value.id, title: value.title, description: value.description, revision: value.revision, source: 'custom', editable: true }; }
export class TemplateLibrary {
  constructor(root) { this.root = resolve(root); }
  async read(id) {
    if (!TEMPLATE_ID.test(id)) throw new Error('模板编号无效。');
    const path = join(this.root, `${id}.json`);
    await directoryInfo(this.root);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_FILE + 4096 || !contained(await realpath(this.root), await realpath(path))) throw new Error('模板记录无效。');
    const value = JSON.parse(await readFile(path, 'utf8'));
    if (value?.schema !== 1 || value.id !== id || !REVISION.test(value.revision)) throw new Error('模板记录无效。');
    plain(value.title, '模板标题', 100); plain(value.description, '模板简介', 1000); bodyText(value.body);
    return value;
  }
  async list() {
    if (!await directoryInfo(this.root, { optional: true })) return [];
    const result = [];
    for (const name of (await readdir(this.root)).filter(name => TEMPLATE_ID.test(name.slice(0, -5)) && name.endsWith('.json')).sort()) {
      try { result.push(templateSummary(await this.read(name.slice(0, -5)))); } catch { continue; }
    }
    return result;
  }
  async get(id) { const value = await this.read(id); return { template: templateSummary(value), body: value.body }; }
  async save(payload) {
    const id = payload?.id ?? randomUUID();
    if (!TEMPLATE_ID.test(id)) throw new Error('模板编号无效。');
    const title = plain(payload?.title, '模板标题', 100), description = plain(payload?.description, '模板简介', 1000), body = bodyText(payload?.body);
    await directoryInfo(this.root, { optional: true });
    return lockedSerial(this.root, async () => {
      await directoryInfo(this.root);
      let current;
      try { current = await this.read(id); } catch (error) { if (!missing(error)) throw error; }
      checkRevision(current?.revision, payload.expectedRevision, '模板');
      const record = { schema: 1, id, title, description, body, revision: hash(JSON.stringify({ id, title, description, body, nonce: randomUUID() })) };
      await atomicText(join(this.root, `${id}.json`), JSON.stringify(record) + '\n', !current);
      return { template: templateSummary(record), body };
    });
  }
}

// Existing callers may pass one read-only root. The app passes one shared registry to every path.
export async function listSkills(root) { const skills = root instanceof SkillLibrary ? await root.list() : await new SkillLibrary({ builtinRoot: root, writableRoot: root }).list(); return root instanceof SkillLibrary ? skills : skills.map(({ name, title, description, folder }) => ({ name, title, description, folder })); }
export async function readSkill(root, name, file = 'SKILL.md') { return root instanceof SkillLibrary ? root.read(name, file) : new SkillLibrary({ builtinRoot: root, writableRoot: root }).read(name, file); }
