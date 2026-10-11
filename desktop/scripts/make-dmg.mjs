import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, stat, symlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Wraps the built Suo.app in a disk image with an Applications shortcut, using only the system's
// ditto and hdiutil. It packs the app npm run bundle made last; it does not rebuild it.
if (process.platform !== 'darwin') throw new Error('DMG 只能在 macOS 上制作。');
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error || result.status !== 0) throw result.error ?? new Error(`${command} 运行失败。`);
}
const desktop = fileURLToPath(new URL('..', import.meta.url));
const bundle = join(desktop, 'src-tauri/target/release/bundle'), app = join(bundle, 'macos/Suo.app');
try { await stat(app); } catch { throw new Error('还没有 Suo.app，请先运行 npm run bundle。'); }
const { version } = JSON.parse(await readFile(join(desktop, 'src-tauri/tauri.conf.json'), 'utf8'));
const arch = process.arch === 'arm64' ? 'aarch64' : process.arch;
const out = join(bundle, 'dmg'), staging = join(out, '.staging'), image = join(out, `Suo_${version}_${arch}.dmg`);
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
// ditto keeps the app's signature, symlinks and permissions.
run('/usr/bin/ditto', [app, join(staging, 'Suo.app')]);
await symlink('/Applications', join(staging, 'Applications'));
run('/usr/bin/hdiutil', ['create', '-volname', 'Suo', '-srcfolder', staging, '-fs', 'HFS+', '-format', 'UDZO', '-imagekey', 'zlib-level=9', '-ov', image]);
await rm(staging, { recursive: true, force: true });
run('/usr/bin/hdiutil', ['verify', '-quiet', image]);
console.log(`已生成 ${image}（${Math.round((await stat(image)).size / 1048576)} MB）。没有 Developer ID 签名和公证时，别人第一次打开要右键选择「打开」。`);
