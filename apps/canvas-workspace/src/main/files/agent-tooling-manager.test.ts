import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';

import { createAgentToolingManager } from './agent-tooling-manager';

const sandboxes: string[] = [];

async function createSandbox(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'agent-tooling-manager-'));
  sandboxes.push(dir);
  return dir;
}

async function writeBundle(root: string, version = '1.2.3'): Promise<string> {
  const bundleRoot = join(root, 'bundle');
  await fs.mkdir(join(bundleRoot, 'canvas-cli', 'skills', 'canvas'), { recursive: true });
  await fs.mkdir(join(bundleRoot, 'canvas-cli', 'skills', 'canvas-bootstrap'), { recursive: true });
  await fs.writeFile(join(bundleRoot, 'canvas-cli', 'index.cjs'), '#!/usr/bin/env node\n');
  await fs.writeFile(
    join(bundleRoot, 'canvas-cli', 'skills', 'canvas', 'SKILL.md'),
    '---\nname: canvas\ndescription: Canvas CLI\n---\n',
  );
  await fs.writeFile(
    join(bundleRoot, 'canvas-cli', 'skills', 'canvas-bootstrap', 'SKILL.md'),
    '---\nname: canvas-bootstrap\ndescription: Bootstrap Canvas\n---\n',
  );
  await fs.writeFile(
    join(bundleRoot, 'canvas-cli-package.json'),
    JSON.stringify({ name: '@pulse-coder/canvas-cli', version }),
  );
  return bundleRoot;
}

afterEach(async () => {
  await Promise.all(sandboxes.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('AgentToolingManager', () => {
  it('installs the bundled existing CLI and every skill without Node or pnpm', async () => {
    const root = await createSandbox();
    const bundleRoot = await writeBundle(root);
    const installRoot = join(root, 'home', '.pulse-coder');
    const skillParents = [
      join(root, 'home', '.pulse-coder', 'skills'),
      join(root, 'home', '.codex', 'skills'),
      join(root, 'home', '.claude', 'skills'),
    ];
    const manager = createAgentToolingManager({
      bundleRoot,
      installRoot,
      skillParents,
      hostExecutable: '/Applications/Pulse Canvas.app/Contents/MacOS/Pulse Canvas',
      platform: 'darwin',
    });

    const installed = await manager.ensureInstalled();

    expect(installed).toMatchObject({
      ok: true,
      version: '1.2.3',
      cliInstalled: true,
      skillsInstalled: true,
    });
    const wrapper = await fs.readFile(join(installRoot, 'bin', 'pulse-canvas'), 'utf8');
    expect(wrapper).toContain('ELECTRON_RUN_AS_NODE=1');
    expect(wrapper).toContain('/Applications/Pulse Canvas.app/Contents/MacOS/Pulse Canvas');
    expect(wrapper).toContain('/tooling/pulse-canvas/.runtime/');
    expect(wrapper).toContain('/index.cjs');
    await expect(fs.stat(join(installRoot, 'bin', 'pulse-canvas')))
      .resolves.toMatchObject({ mode: expect.any(Number) });

    for (const parent of skillParents) {
      const canvasSkill = await fs.readFile(join(parent, 'pulse-canvas', 'SKILL.md'), 'utf8');
      expect(canvasSkill).toContain('name: pulse-canvas');
      expect(canvasSkill).toContain(join(installRoot, 'bin', 'pulse-canvas'));
      expect(canvasSkill).not.toMatch(/^pulse-canvas /m);
      await expect(fs.readFile(join(parent, 'canvas-bootstrap', 'SKILL.md'), 'utf8'))
        .resolves.toContain('name: canvas-bootstrap');
    }
    await expect(manager.status()).resolves.toMatchObject({
      installed: true,
      version: '1.2.3',
      cliInstalled: true,
      skillsInstalled: true,
    });
  });

  it('accepts the source package layout used by development builds', async () => {
    const root = await createSandbox();
    const bundleRoot = join(root, 'packages', 'canvas-cli');
    await fs.mkdir(join(bundleRoot, 'dist', 'skills', 'canvas'), { recursive: true });
    await fs.writeFile(join(bundleRoot, 'dist', 'index.cjs'), '#!/usr/bin/env node\n');
    await fs.writeFile(
      join(bundleRoot, 'dist', 'skills', 'canvas', 'SKILL.md'),
      '---\nname: canvas\ndescription: Canvas CLI\n---\n',
    );
    await fs.writeFile(
      join(bundleRoot, 'package.json'),
      JSON.stringify({ name: '@pulse-coder/canvas-cli', version: '2.0.0' }),
    );
    const manager = createAgentToolingManager({
      bundleRoot,
      installRoot: join(root, 'home', '.pulse-coder'),
      skillParents: [join(root, 'home', '.pulse-coder', 'skills')],
      hostExecutable: '/Applications/Pulse Canvas.app/Contents/MacOS/Pulse Canvas',
      platform: 'darwin',
    });

    await expect(manager.ensureInstalled()).resolves.toMatchObject({
      ok: true,
      version: '2.0.0',
    });
  });

  it('repairs a damaged current-version CLI installation', async () => {
    const root = await createSandbox();
    const bundleRoot = await writeBundle(root, '3.0.0');
    const installRoot = join(root, 'home', '.pulse-coder');
    const manager = createAgentToolingManager({
      bundleRoot,
      installRoot,
      skillParents: [join(root, 'home', '.pulse-coder', 'skills')],
      hostExecutable: '/Applications/Pulse Canvas.app/Contents/MacOS/Pulse Canvas',
      platform: 'darwin',
    });
    await manager.ensureInstalled();
    const fingerprint = (await manager.status()).fingerprint!;
    const installedEntry = join(
      installRoot,
      'tooling',
      'pulse-canvas',
      '.runtime',
      fingerprint,
      'index.cjs',
    );
    await fs.writeFile(installedEntry, 'corrupted');

    await expect(manager.status()).resolves.toMatchObject({
      installed: false,
      cliInstalled: false,
    });

    await expect(manager.ensureInstalled()).resolves.toMatchObject({
      ok: true,
      cliInstalled: true,
    });
    await expect(fs.readFile(installedEntry, 'utf8'))
      .resolves.toBe('#!/usr/bin/env node\n');
  });

  it('does not report an outdated managed skill as current', async () => {
    const root = await createSandbox();
    const bundleRoot = await writeBundle(root, '4.0.0');
    const installRoot = join(root, 'home', '.pulse-coder');
    const skillParent = join(root, 'home', '.pulse-coder', 'skills');
    const manager = createAgentToolingManager({
      bundleRoot,
      installRoot,
      skillParents: [skillParent],
      hostExecutable: '/Applications/Pulse Canvas.app/Contents/MacOS/Pulse Canvas',
      platform: 'darwin',
    });
    await manager.ensureInstalled();
    await fs.writeFile(
      join(skillParent, 'pulse-canvas', '.pulse-canvas-managed.json'),
      JSON.stringify({ version: '3.0.0', source: 'canvas' }),
    );

    await expect(manager.status()).resolves.toMatchObject({
      installed: false,
      skillsInstalled: false,
    });
  });

  it('detects and repairs damaged launcher and managed skill content', async () => {
    const root = await createSandbox();
    const bundleRoot = await writeBundle(root, '4.1.0');
    const installRoot = join(root, 'home', '.pulse-coder');
    const skillParent = join(root, 'home', '.pulse-coder', 'skills');
    const manager = createAgentToolingManager({
      bundleRoot,
      installRoot,
      skillParents: [skillParent],
      hostExecutable: '/Applications/Pulse Canvas.app/Contents/MacOS/Pulse Canvas',
      platform: 'darwin',
    });
    await manager.ensureInstalled();
    const launcher = join(installRoot, 'bin', 'pulse-canvas');
    const skill = join(skillParent, 'pulse-canvas', 'SKILL.md');
    await fs.writeFile(launcher, 'corrupted');
    await fs.writeFile(skill, 'corrupted');

    await expect(manager.status()).resolves.toMatchObject({
      installed: false,
      cliInstalled: false,
      skillsInstalled: false,
    });

    await expect(manager.ensureInstalled()).resolves.toMatchObject({ ok: true });
    await expect(fs.readFile(launcher, 'utf8')).resolves.toContain('ELECTRON_RUN_AS_NODE=1');
    await expect(fs.readFile(skill, 'utf8')).resolves.toContain('name: pulse-canvas');
  });

  it('updates changed bundled bytes even when the CLI version was not bumped', async () => {
    const root = await createSandbox();
    const bundleRoot = await writeBundle(root, '5.0.0');
    const installRoot = join(root, 'home', '.pulse-coder');
    const manager = createAgentToolingManager({
      bundleRoot,
      installRoot,
      skillParents: [join(root, 'home', '.pulse-coder', 'skills')],
      hostExecutable: '/Applications/Pulse Canvas.app/Contents/MacOS/Pulse Canvas',
      platform: 'darwin',
    });
    await manager.ensureInstalled();
    await fs.writeFile(
      join(bundleRoot, 'canvas-cli', 'index.cjs'),
      '#!/usr/bin/env node\nconsole.log("updated");\n',
    );

    await expect(manager.ensureInstalled()).resolves.toMatchObject({ ok: true });
    const fingerprint = (await manager.status()).fingerprint!;
    await expect(fs.readFile(
      join(installRoot, 'tooling', 'pulse-canvas', '.runtime', fingerprint, 'index.cjs'),
      'utf8',
    )).resolves.toContain('updated');
  });

  it('defers an available update at startup when the user chose ask', async () => {
    const root = await createSandbox();
    const bundleRoot = await writeBundle(root, '6.0.0');
    const installRoot = join(root, 'home', '.pulse-coder');
    const options = {
      bundleRoot,
      installRoot,
      skillParents: [join(root, 'home', '.pulse-coder', 'skills')],
      hostExecutable: '/Applications/Pulse Canvas.app/Contents/MacOS/Pulse Canvas',
      platform: 'darwin' as const,
    };
    const manager = createAgentToolingManager(options);
    await manager.ensureInstalled();
    const oldWrapper = await fs.readFile(join(installRoot, 'bin', 'pulse-canvas'), 'utf8');
    await manager.setUpdatePolicy('ask');
    await writeBundle(root, '7.0.0');

    await expect(manager.ensureInstalled()).resolves.toMatchObject({
      ok: true,
      applied: false,
      deferred: true,
      updatePolicy: 'ask',
      updateAvailable: true,
      version: '6.0.0',
      bundledVersion: '7.0.0',
    });
    await expect(fs.readFile(join(installRoot, 'bin', 'pulse-canvas'), 'utf8'))
      .resolves.toBe(oldWrapper);

    await expect(manager.ensureInstalled({ action: 'update' })).resolves.toMatchObject({
      ok: true,
      applied: true,
      deferred: false,
      updateAvailable: false,
      version: '7.0.0',
    });
  });

  it('persists a pinned policy and keeps the active tooling across manager instances', async () => {
    const root = await createSandbox();
    const bundleRoot = await writeBundle(root, '8.0.0');
    const installRoot = join(root, 'home', '.pulse-coder');
    const options = {
      bundleRoot,
      installRoot,
      skillParents: [join(root, 'home', '.pulse-coder', 'skills')],
      hostExecutable: '/Applications/Pulse Canvas.app/Contents/MacOS/Pulse Canvas',
      platform: 'darwin' as const,
    };
    const manager = createAgentToolingManager(options);
    await manager.ensureInstalled();
    await manager.setUpdatePolicy('pinned');
    await writeBundle(root, '9.0.0');

    const restartedManager = createAgentToolingManager(options);
    await expect(restartedManager.status()).resolves.toMatchObject({
      installed: true,
      version: '8.0.0',
      bundledVersion: '9.0.0',
      updatePolicy: 'pinned',
      updateAvailable: true,
    });
    await expect(restartedManager.ensureInstalled()).resolves.toMatchObject({
      applied: false,
      deferred: true,
      version: '8.0.0',
    });
  });

  it('migrates an installation created before active-state tracking', async () => {
    const root = await createSandbox();
    const bundleRoot = await writeBundle(root, '10.0.0');
    const installRoot = join(root, 'home', '.pulse-coder');
    const options = {
      bundleRoot,
      installRoot,
      skillParents: [join(root, 'home', '.pulse-coder', 'skills')],
      hostExecutable: '/Applications/Pulse Canvas.app/Contents/MacOS/Pulse Canvas',
      platform: 'darwin' as const,
    };
    const manager = createAgentToolingManager(options);
    await manager.ensureInstalled();
    await fs.rm(join(installRoot, 'tooling', 'pulse-canvas', 'active.json'));

    const migrated = createAgentToolingManager(options);
    await expect(migrated.status()).resolves.toMatchObject({
      installed: true,
      version: '10.0.0',
      updateAvailable: false,
    });
    await expect(fs.readFile(
      join(installRoot, 'tooling', 'pulse-canvas', 'active.json'),
      'utf8',
    )).resolves.toContain('10.0.0');
  });

  it('repairs the active version without applying a deferred update', async () => {
    const root = await createSandbox();
    const bundleRoot = await writeBundle(root, '11.0.0');
    const installRoot = join(root, 'home', '.pulse-coder');
    const skillParent = join(root, 'home', '.pulse-coder', 'skills');
    const manager = createAgentToolingManager({
      bundleRoot,
      installRoot,
      skillParents: [skillParent],
      hostExecutable: '/Applications/Pulse Canvas.app/Contents/MacOS/Pulse Canvas',
      platform: 'darwin',
    });
    await manager.ensureInstalled();
    const oldWrapper = await fs.readFile(join(installRoot, 'bin', 'pulse-canvas'), 'utf8');
    await manager.setUpdatePolicy('ask');
    await writeBundle(root, '12.0.0');
    const launcher = join(installRoot, 'bin', 'pulse-canvas');
    const skill = join(skillParent, 'pulse-canvas', 'SKILL.md');
    await fs.writeFile(launcher, 'corrupted');
    await fs.writeFile(skill, 'corrupted');

    await expect(manager.ensureInstalled()).resolves.toMatchObject({
      ok: true,
      applied: false,
      deferred: true,
      version: '11.0.0',
      bundledVersion: '12.0.0',
    });
    await expect(fs.readFile(launcher, 'utf8')).resolves.toBe(oldWrapper);
    await expect(fs.readFile(skill, 'utf8')).resolves.toContain('name: pulse-canvas');
  });

  it('does no writes when the bundled tooling is already healthy', async () => {
    const root = await createSandbox();
    const bundleRoot = await writeBundle(root, '13.0.0');
    const installRoot = join(root, 'home', '.pulse-coder');
    const manager = createAgentToolingManager({
      bundleRoot,
      installRoot,
      skillParents: [join(root, 'home', '.pulse-coder', 'skills')],
      hostExecutable: '/Applications/Pulse Canvas.app/Contents/MacOS/Pulse Canvas',
      platform: 'darwin',
    });
    await manager.ensureInstalled();
    const launcher = join(installRoot, 'bin', 'pulse-canvas');
    const before = (await fs.stat(launcher)).mtimeMs;

    await expect(manager.ensureInstalled()).resolves.toMatchObject({
      ok: true,
      applied: false,
      deferred: false,
    });
    await expect(fs.stat(launcher)).resolves.toMatchObject({ mtimeMs: before });
  });

  it('repairs a deleted pinned compatibility bundle from its cache without applying the app update', async () => {
    const root = await createSandbox();
    const bundleRoot = await writeBundle(root, '14.0.0');
    const installRoot = join(root, 'home', '.pulse-coder');
    const manager = createAgentToolingManager({
      bundleRoot,
      installRoot,
      skillParents: [join(root, 'home', '.pulse-coder', 'skills')],
      hostExecutable: '/Applications/Pulse Canvas.app/Contents/MacOS/Pulse Canvas',
      platform: 'darwin',
    });
    await manager.ensureInstalled();
    const activeFingerprint = (await manager.status()).fingerprint!;
    const activeRuntime = join(
      installRoot,
      'tooling',
      'pulse-canvas',
      '.runtime',
      activeFingerprint,
    );
    const oldWrapper = await fs.readFile(join(installRoot, 'bin', 'pulse-canvas'), 'utf8');
    await manager.setUpdatePolicy('pinned');
    await writeBundle(root, '15.0.0');
    await fs.rm(activeRuntime, { recursive: true, force: true });

    await expect(manager.ensureInstalled({ action: 'repair' })).resolves.toMatchObject({
      ok: true,
      applied: false,
      deferred: true,
      version: '14.0.0',
    });
    await expect(fs.readFile(join(activeRuntime, 'index.cjs'), 'utf8'))
      .resolves.toBe('#!/usr/bin/env node\n');
    await expect(fs.readFile(join(activeRuntime, 'skills', 'canvas', 'SKILL.md'), 'utf8'))
      .resolves.toContain('name: canvas');
    await expect(fs.readFile(join(installRoot, 'bin', 'pulse-canvas'), 'utf8'))
      .resolves.toBe(oldWrapper);
  });

  it('rolls back every compatibility-bundle target when one skill cannot be written', async () => {
    const root = await createSandbox();
    const bundleRoot = await writeBundle(root, '16.0.0');
    const installRoot = join(root, 'home', '.pulse-coder');
    const skillParent = join(root, 'home', '.pulse-coder', 'skills');
    const manager = createAgentToolingManager({
      bundleRoot,
      installRoot,
      skillParents: [skillParent],
      hostExecutable: '/Applications/Pulse Canvas.app/Contents/MacOS/Pulse Canvas',
      platform: 'darwin',
    });
    await manager.ensureInstalled();
    const oldStatus = await manager.status();
    const oldRuntimeEntry = join(
      installRoot,
      'tooling',
      'pulse-canvas',
      '.runtime',
      oldStatus.fingerprint!,
      'index.cjs',
    );
    const oldEntryContent = await fs.readFile(oldRuntimeEntry, 'utf8');
    const oldWrapper = await fs.readFile(join(installRoot, 'bin', 'pulse-canvas'), 'utf8');
    const oldSkill = join(skillParent, 'pulse-canvas', 'SKILL.md');
    const oldContent = await fs.readFile(oldSkill, 'utf8');
    await writeBundle(root, '16.0.0');
    await fs.mkdir(join(bundleRoot, 'canvas-cli', 'skills', 'zzz-blocked'), { recursive: true });
    await fs.writeFile(
      join(bundleRoot, 'canvas-cli', 'skills', 'zzz-blocked', 'SKILL.md'),
      '---\nname: zzz-blocked\ndescription: blocked\n---\n',
    );
    await fs.mkdir(skillParent, { recursive: true });
    await fs.writeFile(join(skillParent, 'zzz-blocked'), 'not a directory');

    await expect(manager.ensureInstalled({ action: 'update' })).resolves.toMatchObject({
      ok: false,
      applied: false,
      version: '16.0.0',
      bundledVersion: '16.0.0',
      updateAvailable: true,
    });
    await expect(fs.readFile(oldSkill, 'utf8')).resolves.toBe(oldContent);
    await expect(fs.readFile(join(installRoot, 'bin', 'pulse-canvas'), 'utf8'))
      .resolves.toBe(oldWrapper);
    await expect(fs.readFile(oldRuntimeEntry, 'utf8')).resolves.toBe(oldEntryContent);
    await expect(manager.status()).resolves.toMatchObject({
      installed: true,
      version: '16.0.0',
    });
  });
});
