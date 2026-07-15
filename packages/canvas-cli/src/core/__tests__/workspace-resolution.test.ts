import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { saveCanvas, saveWorkspaceManifest, getWorkspaceDir } from '../store';
import { resolveWorkspaceId, ENV_WORKSPACE_ID } from '../workspace-resolution';
import type { CanvasSaveData } from '../types';

let testDir: string;

const emptyCanvas: CanvasSaveData = {
  nodes: [],
  transform: { x: 0, y: 0, scale: 1 },
  savedAt: '2025-01-01T00:00:00.000Z',
};

async function seedWorkspace(id: string): Promise<void> {
  // saveCanvas writes canvas.json (+ AGENTS.md) so the workspace passes the
  // readable-canvas validation.
  await saveCanvas(id, emptyCanvas, testDir, { allowEmpty: true });
}

beforeEach(async () => {
  testDir = join(tmpdir(), `canvas-cli-resolve-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  await fs.mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

describe('resolveWorkspaceId', () => {
  it('prefers the explicit id over the environment variable and active workspace', async () => {
    await seedWorkspace('ws-explicit');
    await seedWorkspace('ws-env');
    await seedWorkspace('ws-active');
    await saveWorkspaceManifest(
      { workspaces: [{ id: 'ws-active', name: 'Active' }], activeId: 'ws-active' },
      testDir,
    );

    const resolution = await resolveWorkspaceId({
      explicitId: 'ws-explicit',
      storeDir: testDir,
      env: { [ENV_WORKSPACE_ID]: 'ws-env' },
    });
    expect(resolution).toEqual({ workspaceId: 'ws-explicit', source: 'explicit' });
  });

  it('prefers the environment variable over the active workspace', async () => {
    await seedWorkspace('ws-env');
    await seedWorkspace('ws-active');
    await saveWorkspaceManifest(
      { workspaces: [{ id: 'ws-active', name: 'Active' }], activeId: 'ws-active' },
      testDir,
    );

    const resolution = await resolveWorkspaceId({
      storeDir: testDir,
      env: { [ENV_WORKSPACE_ID]: 'ws-env' },
    });
    expect(resolution).toEqual({ workspaceId: 'ws-env', source: 'environment' });
  });

  it('falls back to the manifest activeId when nothing is passed', async () => {
    await seedWorkspace('ws-active');
    await saveWorkspaceManifest(
      { workspaces: [{ id: 'ws-active', name: 'Active' }], activeId: 'ws-active' },
      testDir,
    );

    const resolution = await resolveWorkspaceId({ storeDir: testDir, env: {} });
    expect(resolution).toEqual({ workspaceId: 'ws-active', source: 'manifest-active' });
  });

  it('reads the activeId from the store named by --store-dir', async () => {
    // A second store the resolution should NOT see.
    const otherDir = join(tmpdir(), `canvas-cli-resolve-other-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    await fs.mkdir(otherDir, { recursive: true });
    try {
      await saveCanvas('ws-other', emptyCanvas, otherDir, { allowEmpty: true });
      await saveWorkspaceManifest(
        { workspaces: [{ id: 'ws-other', name: 'Other' }], activeId: 'ws-other' },
        otherDir,
      );
      await seedWorkspace('ws-here');
      await saveWorkspaceManifest(
        { workspaces: [{ id: 'ws-here', name: 'Here' }], activeId: 'ws-here' },
        testDir,
      );

      const resolution = await resolveWorkspaceId({ storeDir: testDir, env: {} });
      expect(resolution).toEqual({ workspaceId: 'ws-here', source: 'manifest-active' });
    } finally {
      await fs.rm(otherDir, { recursive: true, force: true });
    }
  });

  it('throws — never silently substitutes — when the activeId workspace does not exist', async () => {
    await saveWorkspaceManifest(
      { workspaces: [{ id: 'ws-gone', name: 'Gone' }], activeId: 'ws-gone' },
      testDir,
    );

    await expect(resolveWorkspaceId({ storeDir: testDir, env: {} })).rejects.toThrow(/not found/);
  });

  it('throws on an unsafe activeId rather than resolving it', async () => {
    // Write the manifest raw so the unsafe id survives to resolution.
    await fs.writeFile(
      join(testDir, '__workspaces__.json'),
      JSON.stringify({ workspaces: [], activeId: '../escape' }),
      'utf-8',
    );

    await expect(resolveWorkspaceId({ storeDir: testDir, env: {} })).rejects.toThrow(/[Uu]nsafe/);
  });

  it('throws a selection hint when there is no manifest to guess from', async () => {
    await expect(resolveWorkspaceId({ storeDir: testDir, env: {} })).rejects.toThrow(
      /No workspace selected/,
    );
  });

  it('rejects an explicit id whose canvas.json is missing', async () => {
    await expect(
      resolveWorkspaceId({ explicitId: 'ws-nope', storeDir: testDir, env: {} }),
    ).rejects.toThrow(/not found/);
  });

  it('skips the readable-canvas check when requireReadableCanvas is false (runtime/restore path)', async () => {
    // No canvas.json on disk, but the id is safe — runtime-mediated commands
    // (agent, team) and restore must still resolve it.
    await saveWorkspaceManifest(
      { workspaces: [{ id: 'ws-runtime', name: 'Runtime' }], activeId: 'ws-runtime' },
      testDir,
    );

    const resolution = await resolveWorkspaceId({
      storeDir: testDir,
      env: {},
      requireReadableCanvas: false,
    });
    expect(resolution).toEqual({ workspaceId: 'ws-runtime', source: 'manifest-active' });
    // And nothing was created on disk.
    await expect(fs.access(join(getWorkspaceDir('ws-runtime', testDir), 'canvas.json'))).rejects.toThrow();
  });

  it('recovers an explicit id whose canvas.json is corrupt but has a .bak', async () => {
    await seedWorkspace('ws-bak');
    const canvasFile = join(getWorkspaceDir('ws-bak', testDir), 'canvas.json');
    await fs.copyFile(canvasFile, `${canvasFile}.bak`);
    await fs.writeFile(canvasFile, '{ truncated', 'utf-8');

    // readFile of the corrupt primary still succeeds (validation checks
    // readability, not parseability), so this resolves via the primary — but
    // even a genuinely unreadable primary would fall through to the .bak.
    const resolution = await resolveWorkspaceId({ explicitId: 'ws-bak', storeDir: testDir, env: {} });
    expect(resolution).toEqual({ workspaceId: 'ws-bak', source: 'explicit' });
  });
});
