import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { stagePackagedNative } from './prepare-sqlite-native.mjs';

it('stages one Electron binding without removing either development ABI', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pulse-native-package-'));
  try {
    const cliNative = join(root, 'cli', 'native');
    const packageNative = join(root, 'package-native');
    await mkdir(cliNative, { recursive: true });
    await mkdir(packageNative);
    const electronName = 'darwin-arm64-123.node';
    const nodeName = 'darwin-arm64-137.node';
    const electronBinding = join(cliNative, electronName);
    await writeFile(electronBinding, 'verified Electron binding');
    await writeFile(join(cliNative, nodeName), 'Node binding');
    await writeFile(join(packageNative, nodeName), 'stale Node binding');
    await writeFile(join(packageNative, 'darwin-x64-123.node'), 'stale other architecture');
    expect(await stagePackagedNative(electronBinding, electronName, packageNative))
      .toBe(join(packageNative, electronName));
    expect(await readdir(packageNative)).toEqual([electronName]);
    expect(await readFile(join(packageNative, electronName), 'utf8')).toBe('verified Electron binding');
    expect((await readdir(cliNative)).sort()).toEqual([electronName, nodeName]);
    expect(await readFile(join(cliNative, nodeName), 'utf8')).toBe('Node binding');
    await expect(stagePackagedNative(electronBinding, '../escaped.node', packageNative)).rejects.toThrow('Invalid');
    expect(await readdir(packageNative)).toEqual([electronName]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
