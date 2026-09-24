import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';
import { prepareNodeNative } from './prepare-native.mjs';

it('copies a loadable current-Node binding without rebuilding the installed dependency', async () => {
  const require = createRequire(import.meta.url);
  const Database = require('better-sqlite3');
  const installed = join(dirname(require.resolve('better-sqlite3/package.json')), 'build', 'Release', 'better_sqlite3.node');
  const digest = async (path) => createHash('sha256').update(await readFile(path)).digest('hex');
  const before = await digest(installed);
  const output = await mkdtemp(join(tmpdir(), 'canvas-native-build-'));
  try {
    const prepared = await prepareNodeNative(output);
    expect(prepared.destination).toBe(join(output, `${process.platform}-${process.arch}-${process.versions.modules}.node`));
    expect(await digest(prepared.destination)).toBe(before);
    expect(await digest(installed)).toBe(before);
    const db = new Database(':memory:', { nativeBinding: prepared.destination });
    try {
      expect(db.prepare('SELECT sqlite_version() AS version').get().version).toBe(prepared.sqliteVersion);
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      db.close();
    }
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
