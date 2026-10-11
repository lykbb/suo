import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

// Only the product role and skill text are shipped; user data and credentials stay outside.
export async function runtimeResources(source) {
  const files = [];
  const visit = async path => {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error('打包角色与技能资源不能包含软链接。');
    if (info.isDirectory()) {
      for (const name of (await readdir(path)).filter(name => !name.startsWith('.')).sort()) await visit(join(path, name));
    } else if (info.isFile()) files.push(relative(source, path));
    else throw new Error('打包角色与技能资源类型无效。');
  };
  await visit(join(source, 'agent.md'));
  await visit(join(source, 'skills'));
  const fingerprint = createHash('sha256');
  for (const path of files) fingerprint.update(path).update('\0').update(await readFile(join(source, path))).update('\0');
  return { files, digest: fingerprint.digest('hex') };
}

export async function copyRuntimeResources(source, target) {
  const resources = await runtimeResources(source);
  await mkdir(target, { recursive: true });
  await cp(join(source, 'agent.md'), join(target, 'agent.md'), { errorOnExist: true, force: false });
  await cp(join(source, 'skills'), join(target, 'skills'), { recursive: true, errorOnExist: true, force: false,
    filter: path => !relative(join(source, 'skills'), path).split('/').some(part => part.startsWith('.')) });
  return resources;
}
