import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const desktop = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const testsRoot = await realpath(join(desktop, 'tests'));
const requested = process.argv.slice(2);
const paths = requested.length ? requested : (await readdir(testsRoot)).filter(name => name.endsWith('.test.mjs')).sort().map(name => join('tests', name));
if (!paths.length) throw new Error('没有找到测试文件。');
const tests = [];
for (const path of paths) {
  const target = await realpath(isAbsolute(path) ? path : resolve(desktop, path));
  const inside = relative(testsRoot, target);
  if (!inside || inside.startsWith(`..${sep}`) || inside === '..' || isAbsolute(inside) || !target.endsWith('.test.mjs') || !(await stat(target)).isFile()) {
    throw new Error(`测试路径必须是 tests 内的 .test.mjs 文件：${path}`);
  }
  tests.push(target);
}

const runId = randomUUID();
const previewRoot = join(desktop, 'preview');
await mkdir(previewRoot, { recursive: true, mode: 0o700 });
if (await realpath(previewRoot) !== previewRoot) throw new Error('测试产物目录不能通过软链接指向项目外。');
const runsRoot = join(previewRoot, 'test-runs');
await mkdir(runsRoot, { recursive: true, mode: 0o700 });
if (await realpath(runsRoot) !== runsRoot) throw new Error('测试产物目录不能通过软链接指向项目外。');
const root = join(runsRoot, `run-${runId}`);
await mkdir(root, { mode: 0o700 });
const data = join(root, 'data'), fixtures = join(root, 'fixtures'), trash = join(root, 'trash');
for (const directory of [data, fixtures, trash]) await mkdir(directory, { mode: 0o700 });
const marker = {
  schema: 1, owner: 'suo-desktop-test-run', runId, root, desktop,
  createdAt: new Date().toISOString(), tests: tests.map(path => relative(desktop, path)),
  directories: { data, fixtures, trash },
};
await writeFile(join(root, 'test-run.json'), JSON.stringify(marker, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(`Suo 测试隔离目录：${root}`);
const child = spawn(process.execPath, ['--import', pathToFileURL(join(desktop, 'tests/helpers/test-data.mjs')).href, '--test', ...tests], {
  cwd: desktop, stdio: 'inherit',
  env: { ...process.env, SUO_TEST_DATA: root, SUO_DESKTOP_DATA: data, SUO_TEST_TRASH_ROOT: trash, PI_OFFLINE: '1', DO_NOT_TRACK: '1' },
});
const forward = signal => child.kill(signal);
const onInterrupt = () => forward('SIGINT'), onTerminate = () => forward('SIGTERM');
process.on('SIGINT', onInterrupt);
process.on('SIGTERM', onTerminate);
let result;
try {
  result = await new Promise((resolveResult, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolveResult({ code, signal }));
  });
} catch (error) {
  result = { code: 1, signal: null, error: error.message };
} finally {
  process.off('SIGINT', onInterrupt);
  process.off('SIGTERM', onTerminate);
}
// A passing run leaves nothing behind; a failing one keeps its data and result for diagnosis.
if (result.code === 0) {
  await rm(root, { recursive: true, force: true });
  console.log('Suo 测试全部通过，已清理本次测试目录。');
} else {
  await writeFile(join(root, 'test-result.json'), JSON.stringify({ ...result, completedAt: new Date().toISOString() }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(`Suo 测试未全部通过，测试产物已保留：${root}`);
}
process.exitCode = result.code ?? (result.signal === 'SIGINT' ? 130 : result.signal === 'SIGTERM' ? 143 : 1);
