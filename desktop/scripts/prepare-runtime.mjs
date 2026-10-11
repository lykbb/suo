import { cp, mkdir, readFile, readdir, writeFile, chmod, lstat, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { copyRuntimeResources, runtimeResources } from './runtime-resources.mjs';

const desktop = fileURLToPath(new URL('../', import.meta.url));
// Isolated candidates reuse the installed dependency tree without moving the source project.
const source = process.env.SUO_RUNTIME_SOURCE ?? resolve(await realpath(join(desktop, 'node_modules')), '..', '..');
const target = join(desktop, 'build-resources/runtime');
const resources = await runtimeResources(source);
const fingerprint = createHash('sha256').update(process.version).update(await readFile(join(source, 'package-lock.json'))).update(resources.digest);
for (const name of (await readdir(join(source, 'extensions'))).sort()) fingerprint.update(await readFile(join(source, 'extensions', name)));
const digest = fingerprint.digest('hex');
try {
  await lstat(target);
  const prior = JSON.parse(await readFile(join(target, 'ready.json'), 'utf8').catch(() => '{}'));
  if (prior.digest === digest && prior.platform === process.platform && prior.arch === process.arch) {
    try {
      await lstat(join(target, 'node'));
      await lstat(join(target, 'suo/state/engine/dist/bundle/cli.js'));
      const packaged = await runtimeResources(join(target, 'suo'));
      if (packaged.digest !== resources.digest) throw new Error('角色或技能资源不一致。');
    } catch { throw new Error('打包运行时文件缺失或角色技能不一致。请先确认该目录的清理，再重新生成。'); }
    try { await lstat(join(target, 'suo/package.json')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await cp(join(source, 'package.json'), join(target, 'suo/package.json'), { errorOnExist: true, force: false });
    }
    console.log('复用已完成的本机运行时，继续打包当前界面。'); process.exit(0);
  }
  throw new Error('旧打包运行时不完整或依赖、角色、技能已变化。请先确认该目录的清理，再重新生成。');
}
catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(target, { recursive: true });
await cp(process.execPath, join(target, 'node'), { errorOnExist: true, force: false });
await chmod(join(target, 'node'), 0o755);
const runtime = join(target, 'suo');
await mkdir(runtime);
await cp(join(source, 'package.json'), join(runtime, 'package.json'), { errorOnExist: true, force: false });
await cp(join(source, 'node_modules'), join(runtime, 'node_modules'), {
  recursive: true, dereference: true, errorOnExist: true, force: false,
  filter: path => !relative(join(source, 'node_modules'), path).split('/').some(part => ['.cache', '.bin'].includes(part)),
});
await cp(join(source, 'extensions'), join(runtime, 'extensions'), { recursive: true, errorOnExist: true, force: false });
await copyRuntimeResources(source, runtime);
const engineSource = join(source, 'node_modules/@earendil-works/pi-coding-agent');
const engineTarget = join(runtime, 'state/engine');
await cp(engineSource, engineTarget, { recursive: true, dereference: true, errorOnExist: true, force: false, filter: path => path !== join(engineSource, 'package.json') });
const manifest = JSON.parse(await readFile(join(engineSource, 'package.json'), 'utf8'));
await writeFile(join(engineTarget, 'package.json'), JSON.stringify({ ...manifest, piConfig: { name: 'suo', configDir: '.suo' } }), { flag: 'wx' });
for (const name of ['LICENSE', 'NOTICE']) await cp(join(source, name), join(runtime, name), { errorOnExist: true, force: false });
await writeFile(join(target, 'ready.json'), JSON.stringify({ digest, resourcesDigest: resources.digest, nodeVersion: process.version, platform: process.platform, arch: process.arch }), { flag: 'wx' });
console.log('已准备本机 Node、Suo 角色与技能运行时；未复制 state/agent、凭证、历史或用户资料。');
