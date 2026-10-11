import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') throw new Error('此打包入口目前只验证了 macOS。');
const bundle = fileURLToPath(new URL('../src-tauri/target/release/bundle/macos/Suo.app', import.meta.url));
// Local ad-hoc signing does not use a developer account or publish the app.
if (!process.env.APPLE_SIGNING_IDENTITY) {
  const signed = spawnSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', bundle], { stdio: 'inherit' });
  if (signed.error || signed.status !== 0) throw signed.error ?? new Error('本地签名失败。');
}
const verified = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'inherit' });
if (verified.error || verified.status !== 0) throw verified.error ?? new Error('应用签名验证失败。');
console.log('macOS 应用包签名检查通过；对外分发仍需 Developer ID 签名和公证。');
