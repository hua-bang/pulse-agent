import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveSqliteNativeBinding } from '../native-binding';

const roots: string[] = [];
const runtime = { platform: 'darwin', arch: 'arm64', modules: '123', electron: '30.5.1' };

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'canvas-sqlite-binding-'));
  roots.push(root);
  await mkdir(join(root, 'dist', 'native'), { recursive: true });
  await mkdir(join(root, 'dist', 'core'), { recursive: true });
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('resolveSqliteNativeBinding', () => {
  it('resolves the same ABI payload from executable and core entrypoints', async () => {
    const root = await fixture();
    const binding = join(root, 'dist', 'native', 'darwin-arm64-123.node');
    await writeFile(binding, 'electron fixture');
    expect(resolveSqliteNativeBinding(join(root, 'dist'), runtime)).toBe(binding);
    expect(resolveSqliteNativeBinding(join(root, 'dist', 'core'), runtime)).toBe(binding);
  });

  it('never substitutes a Node binary when the Electron ABI is missing', async () => {
    const root = await fixture();
    await writeFile(join(root, 'dist', 'native', 'darwin-arm64-137.node'), 'node fixture');
    const installed = join(root, 'node_modules', 'better-sqlite3');
    await mkdir(join(installed, 'build', 'Release'), { recursive: true });
    await writeFile(join(installed, 'package.json'), JSON.stringify({ name: 'better-sqlite3' }));
    await writeFile(join(installed, 'build', 'Release', 'better_sqlite3.node'), 'node fixture');
    expect(() => resolveSqliteNativeBinding(join(root, 'dist'), runtime))
      .toThrow('SQLite native binding missing for darwin/arm64 ABI 123 (Electron 30.5.1)');
    expect(resolveSqliteNativeBinding(join(root, 'dist'), { ...runtime, electron: undefined }))
      .toBe(await realpath(join(installed, 'build', 'Release', 'better_sqlite3.node')));
  });
});
