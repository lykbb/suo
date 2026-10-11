import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { foreignBrand } from './helpers.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
// Build output, copied app bundles, backups and local data repeat source files or hold user content.
const generated = ['node_modules', 'state', '.test-*', '.git', 'design', 'desktop/data', 'desktop/dist', 'desktop/releases', 'desktop/backups',
  'desktop/preview', 'desktop/build-resources', 'desktop/src-tauri/target', 'desktop/src-tauri/gen', 'desktop/.cargo-cache', 'desktop/.npm-cache'];

test('project files carry no engine or vendor branding outside the credits', () => {
  const prune = generated.flatMap(path => ['-path', path.includes('/') ? join(projectRoot, path) : `*/${path}`, '-prune', '-o']);
  const listed = spawnSync('/usr/bin/find', [projectRoot, ...prune, '-type', 'f', '-print'], { encoding: 'utf8' }).stdout.trim().split('\n');
  // Credits must name the upstream projects; the lockfiles list dependency metadata. Dependency
  // package names and PI_* variables are the engine's interface, not Suo branding.
  const exempt = new Set(['LICENSE', 'NOTICE', 'README.md', 'package-lock.json', 'desktop/package-lock.json'].map(name => join(projectRoot, name)));
  for (const file of listed.filter(path => !exempt.has(path) && /\.(m?js|json|md)$|\.gitignore$/.test(path))) {
    let text = readFileSync(file, 'utf8').replace(/@earendil-works\/[\w-]+/g, '').replace(/\bPI_\w*/g, '').replaceAll('piConfig', '');
    assert.doesNotMatch(text, foreignBrand, file);
  }
});
