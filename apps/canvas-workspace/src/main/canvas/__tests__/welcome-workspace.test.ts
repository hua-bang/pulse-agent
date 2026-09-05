import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  WELCOME_WORKSPACE_ID,
  WELCOME_WORKSPACE_NAME,
  ensureWelcomeWorkspaceSeeded,
} from '../welcome-workspace';
import { readCanvasFull } from '../storage';
import { saveCanvas } from '../service';
import { listWorkspaces, WORKSPACES_MANIFEST_FILENAME } from '../workspaces';

let root: string;

beforeEach(async () => {
  root = join(tmpdir(), `welcome-workspace-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await fs.mkdir(root, { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function writeManifest(payload: unknown): Promise<void> {
  await fs.writeFile(join(root, WORKSPACES_MANIFEST_FILENAME), JSON.stringify(payload), 'utf-8');
}

describe('welcome workspace seed', () => {
  it('seeds a focused empty first-run workspace', async () => {
    const result = await ensureWelcomeWorkspaceSeeded(root, 'zh');

    expect(result).toEqual({ seeded: true, workspaceId: WELCOME_WORKSPACE_ID });

    const listing = await listWorkspaces(root);
    expect(listing.activeId).toBe(WELCOME_WORKSPACE_ID);
    expect(listing.workspaces).toEqual([
      { id: WELCOME_WORKSPACE_ID, name: WELCOME_WORKSPACE_NAME, rootFolder: undefined },
    ]);

    const canvas = await readCanvasFull(WELCOME_WORKSPACE_ID, root);
    expect(canvas.data?.nodes).toEqual([]);
    expect(canvas.data?.edges).toEqual([]);
    expect(canvas.data?.transform).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it('migrates the untouched remote Welcome download node to local HTML', async () => {
    await ensureWelcomeWorkspaceSeeded(root, 'zh');
    const before = await readCanvasFull(WELCOME_WORKSPACE_ID, root);
    const nodes = [{
      id: 'node-welcome-download',
      type: 'iframe' as const,
      title: 'Pulse Canvas Download',
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      data: { mode: 'url', url: 'https://pulse-canvas-download.pages.dev/', html: '' },
      updatedAt: Date.now(),
    }];
    await saveCanvas(WELCOME_WORKSPACE_ID, { ...before.data!, nodes }, { root });

    await expect(ensureWelcomeWorkspaceSeeded(root, 'zh')).resolves.toEqual({ seeded: false });

    const after = await readCanvasFull(WELCOME_WORKSPACE_ID, root);
    const download = after.data?.nodes?.find((node) => node.id === 'node-welcome-download');
    expect(download?.data).toMatchObject({ mode: 'html', url: '', html: '' });
    expect(download?.data?.localUrl).toContain('pulse-canvas://app/download-site/index.html?');
  });

  it('does not seed when a manifest already has workspaces', async () => {
    await writeManifest({
      activeId: 'ws-existing',
      workspaces: [{ id: 'ws-existing', name: 'Existing' }],
      folders: [],
    });

    const result = await ensureWelcomeWorkspaceSeeded(root);

    expect(result.seeded).toBe(false);
    const listing = await listWorkspaces(root);
    expect(listing.workspaces).toEqual([
      { id: 'ws-existing', name: 'Existing', rootFolder: undefined },
    ]);
    await expect(fs.access(join(root, WELCOME_WORKSPACE_ID, 'canvas.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not seed when workspace data already exists without a manifest', async () => {
    await fs.mkdir(join(root, 'ws-orphan'), { recursive: true });

    const result = await ensureWelcomeWorkspaceSeeded(root);

    expect(result.seeded).toBe(false);
    const listing = await listWorkspaces(root);
    expect(listing.workspaces).toEqual([
      { id: 'ws-orphan', name: 'ws-orphan' },
    ]);
    await expect(fs.access(join(root, WORKSPACES_MANIFEST_FILENAME))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
