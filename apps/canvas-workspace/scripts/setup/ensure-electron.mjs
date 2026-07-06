#!/usr/bin/env node
/**
 * Ensure the Electron binary is installed — for environments where the
 * postinstall download failed or was skipped (ELECTRON_SKIP_BINARY_DOWNLOAD,
 * proxies that block GitHub releases, offline CI images).
 *
 *   pnpm --filter canvas-workspace setup:electron
 *
 * Tries the default download first, then falls back to the npmmirror CDN
 * (override with ELECTRON_MIRROR — if you set it, only your mirror is used).
 * Idempotent: exits 0 immediately when the binary is already present.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(appRoot, 'package.json'));

const FALLBACK_MIRROR = 'https://npmmirror.com/mirrors/electron/';

const electronDir = () => {
  try {
    return realpathSync(dirname(require.resolve('electron/package.json')));
  } catch {
    console.error('[setup:electron] electron is not in node_modules — run pnpm install first.');
    process.exit(2);
  }
};

const isReady = (dir) => existsSync(join(dir, 'path.txt')) && existsSync(join(dir, 'dist'));

const tryInstall = (dir, mirror) => {
  const env = { ...process.env };
  delete env.ELECTRON_SKIP_BINARY_DOWNLOAD;
  if (mirror) env.ELECTRON_MIRROR = mirror;
  const label = mirror ? `mirror ${mirror}` : 'default source';
  console.log(`[setup:electron] downloading via ${label}...`);
  const result = spawnSync(process.execPath, ['install.js'], { cwd: dir, env, stdio: 'pipe', encoding: 'utf-8' });
  if (result.status === 0 && isReady(dir)) return true;
  const detail = (result.stderr || result.stdout || '').split('\n').filter(Boolean).slice(-2).join(' | ');
  console.warn(`[setup:electron] ${label} failed${detail ? `: ${detail}` : ''}`);
  return false;
};

const dir = electronDir();
if (isReady(dir)) {
  console.log(`[setup:electron] already installed (${dir})`);
  process.exit(0);
}

const attempts = process.env.ELECTRON_MIRROR
  ? [process.env.ELECTRON_MIRROR]
  : [undefined, FALLBACK_MIRROR];
for (const mirror of attempts) {
  if (tryInstall(dir, mirror)) {
    console.log('[setup:electron] done');
    process.exit(0);
  }
}
console.error('[setup:electron] all download sources failed — set ELECTRON_MIRROR to a reachable mirror and retry.');
process.exit(1);
