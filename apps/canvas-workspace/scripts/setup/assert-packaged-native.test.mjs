import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { assertPackagedNative } from './assert-packaged-native.mjs';

let directory;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'pulse-native-assert-')); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

it('accepts the single staged binding for the packaged platform and architecture', async () => {
  await writeFile(join(directory, 'darwin-arm64-123.node'), 'binding');
  expect(await assertPackagedNative({ platform: 'darwin', arch: 'arm64', directory })).toBe('darwin-arm64-123.node');
});

it.each([
  ['a host-architecture binding for a cross-architecture target', ['darwin-x64-123.node'], 'arm64'],
  ['a universal target backed by one architecture', ['darwin-arm64-123.node'], 'universal'],
  ['no staged binding', [], 'arm64'],
])('rejects %s', async (_case, files, arch) => {
  for (const file of files) await writeFile(join(directory, file), 'binding');
  await expect(assertPackagedNative({ platform: 'darwin', arch, directory })).rejects.toThrow('matching host');
});

it('rejects a missing staging directory', async () => {
  await expect(assertPackagedNative({ platform: 'linux', arch: 'x64', directory: join(directory, 'absent') }))
    .rejects.toThrow('none');
});
