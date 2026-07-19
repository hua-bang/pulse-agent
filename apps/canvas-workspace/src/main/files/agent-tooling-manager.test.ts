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
    expect(wrapper).toContain('/tooling/pulse-canvas/1.2.3/index.cjs');
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
    const installedEntry = join(
      installRoot,
      'tooling',
      'pulse-canvas',
      '3.0.0',
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
    await expect(fs.readFile(
      join(installRoot, 'tooling', 'pulse-canvas', '5.0.0', 'index.cjs'),
      'utf8',
    )).resolves.toContain('updated');
  });
});
