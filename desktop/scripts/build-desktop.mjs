import { spawnSync } from 'node:child_process';
import { dirname, join, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = {
  ...process.env,
  PATH: [dirname(process.execPath), join(homedir(), '.cargo/bin'), process.env.PATH].filter(Boolean).join(delimiter),
  CARGO_HOME: process.env.CARGO_HOME ?? join(root, '.cargo-cache'),
};
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error('桌面打包失败，请检查上方构建结果。');
}
run(['scripts/prepare-runtime.mjs']);
run(['node_modules/@tauri-apps/cli/tauri.js', 'build', '--config', 'src-tauri/tauri.release.conf.json', '--bundles', 'app']);
run(['scripts/sign-local.mjs']);
