import { readFileSync, realpathSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
const refused = () => new Error('测试缺少有效的隔离目录；请使用 npm test 或 npm test -- tests/具体文件.test.mjs。');
const contained = (root, path) => {
  const inside = relative(root, path);
  return inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside);
};

export function requireTestRun() {
  try {
    const root = process.env.SUO_TEST_DATA;
    if (!root || !isAbsolute(root) || resolve(root) !== root || realpathSync(root) !== root) throw refused();
    const runsRoot = join(desktop, 'preview/test-runs');
    if (realpathSync(runsRoot) !== runsRoot || dirname(root) !== runsRoot || !/^run-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(basename(root))) throw refused();
    const marker = JSON.parse(readFileSync(join(root, 'test-run.json'), 'utf8'));
    if (marker.schema !== 1 || marker.owner !== 'suo-desktop-test-run' || marker.root !== root || marker.desktop !== desktop || marker.runId !== basename(root).slice(4)) throw refused();
    for (const name of ['data', 'fixtures', 'trash']) {
      const path = join(root, name);
      if (marker.directories?.[name] !== path || realpathSync(path) !== path) throw refused();
    }
    for (const name of ['SUO_DESKTOP_DATA', 'SUO_TEST_TRASH_ROOT']) {
      const path = process.env[name];
      if (!path || !isAbsolute(path) || !contained(root, path) || realpathSync(path) !== path) throw refused();
    }
    return { root, ...marker.directories };
  } catch {
    throw refused();
  }
}

requireTestRun();

export async function createTestDirectory(prefix) {
  if (typeof prefix !== 'string' || !/^[a-z][a-z0-9-]*-$/u.test(prefix)) throw new Error('测试目录前缀必须以字母开头、以 - 结尾，且不包含路径。');
  return mkdtemp(join(requireTestRun().fixtures, prefix));
}
