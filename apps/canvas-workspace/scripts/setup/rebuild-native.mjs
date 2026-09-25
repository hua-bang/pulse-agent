#!/usr/bin/env node
/**
 * Postinstall: build node-pty for Electron.
 *
 *   pnpm --filter canvas-workspace rebuild
 *
 * First tries `electron-rebuild` (Electron headers from electronjs.org). When
 * that host is unreachable (egress proxies, offline images), falls back to a
 * plain node-gyp build against the host Node headers. node-pty 1.x is N-API
 * (node-addon-api), so that binary is ABI-stable and loads in Electron too.
 * Exits non-zero only when both paths fail.
 */
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(appRoot, 'package.json'));

const run = (command, args, cwd, shell = false) =>
  spawnSync(command, args, { cwd, shell, stdio: 'inherit' }).status === 0;

// `-o` (only), not `-w`: `-w` adds node-pty to the normal rebuild set, which
// would also overwrite the shared SQLite Node binary (see packaged-tooling.md).
// Windows resolves the electron-rebuild .cmd shim only through a shell.
if (run('electron-rebuild', ['-f', '-o', 'node-pty'], appRoot, process.platform === 'win32')) process.exit(0);

console.warn('[rebuild-native] electron-rebuild failed; falling back to an N-API build with host Node headers.');
const rebuildDir = realpathSync(join(appRoot, 'node_modules', '@electron', 'rebuild'));
const nodeGyp = createRequire(join(rebuildDir, 'package.json')).resolve('node-gyp/bin/node-gyp.js');
const nodePtyDir = dirname(require.resolve('node-pty/package.json'));

if (run(process.execPath, [nodeGyp, 'rebuild'], nodePtyDir)) {
  console.log(`[rebuild-native] built node-pty in ${nodePtyDir}`);
  process.exit(0);
}
console.error('[rebuild-native] node-pty build failed with both electron-rebuild and node-gyp.');
process.exit(1);
