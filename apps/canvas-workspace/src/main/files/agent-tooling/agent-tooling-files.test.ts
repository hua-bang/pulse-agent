import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { BUNDLE_MARKER, fingerprintCliTree, isBundleCurrent } from './agent-tooling-files';
import { createAgentToolingManager } from './agent-tooling-manager';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('native agent tooling integrity', () => {
  it.each(['damage', 'delete'])('repairs a %s of the installed native payload from the cached bundle', async (failure) => {
    const root = await fs.mkdtemp(join(tmpdir(), 'agent-tooling-native-repair-'));
    roots.push(root);
    const bundleRoot = join(root, 'bundle');
    const cliRoot = join(bundleRoot, 'canvas-cli');
    await fs.mkdir(join(cliRoot, 'skills', 'canvas'), { recursive: true });
    await fs.mkdir(join(cliRoot, 'native'));
    await fs.writeFile(join(cliRoot, 'index.cjs'), '#!/usr/bin/env node\n');
    await fs.writeFile(join(cliRoot, 'skills', 'canvas', 'SKILL.md'), '---\nname: canvas\ndescription: Canvas CLI\n---\n');
    await fs.writeFile(join(cliRoot, 'native', 'darwin-arm64-123.node'), 'valid binary');
    await fs.writeFile(join(bundleRoot, 'canvas-cli-package.json'), JSON.stringify({ name: '@pulse-coder/canvas-cli', version: '1.0.0' }));
    const installRoot = join(root, 'home');
    const manager = createAgentToolingManager({
      bundleRoot,
      installRoot,
      skillParents: [join(root, 'skills')],
      hostExecutable: '/Applications/Pulse Canvas.app/Contents/MacOS/Pulse Canvas',
      platform: 'darwin',
    });
    const installed = await manager.ensureInstalled();
    expect(installed.ok).toBe(true);
    const fingerprint = (await manager.status()).fingerprint!;
    const binary = join(installRoot, 'tooling', 'pulse-canvas', '.runtime', fingerprint, 'native', 'darwin-arm64-123.node');
    if (failure === 'damage') await fs.writeFile(binary, 'damaged binary');
    else await fs.rm(binary);
    expect(await manager.status()).toMatchObject({ installed: false, cliInstalled: false });
    expect(await manager.ensureInstalled()).toMatchObject({ ok: true, cliInstalled: true });
    expect(await fs.readFile(binary, 'utf8')).toBe('valid binary');
  });

  it('detects damaged, missing and substituted ABI payloads with unchanged CLI code', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'agent-tooling-native-'));
    roots.push(root);
    await fs.mkdir(join(root, 'skills'));
    await fs.mkdir(join(root, 'native'));
    await fs.writeFile(join(root, 'index.cjs'), 'unchanged CLI');
    const binary = join(root, 'native', 'darwin-arm64-123.node');
    await fs.writeFile(binary, 'valid binary');
    const fingerprint = await fingerprintCliTree(root);
    await fs.writeFile(join(root, BUNDLE_MARKER), JSON.stringify({ fingerprint }));
    expect(await isBundleCurrent(root, fingerprint)).toBe(true);

    await fs.writeFile(binary, 'damaged binary');
    expect(await isBundleCurrent(root, fingerprint)).toBe(false);
    await fs.writeFile(binary, 'valid binary');
    await fs.rename(binary, join(root, 'native', 'darwin-arm64-137.node'));
    expect(await isBundleCurrent(root, fingerprint)).toBe(false);
    await fs.rm(join(root, 'native'), { recursive: true });
    expect(await isBundleCurrent(root, fingerprint)).toBe(false);
  });
});
