import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';

const { sandboxHome, ipcHandlers } = vi.hoisted(() => {
  const base = process.env.TMPDIR || '/tmp';
  return {
    sandboxHome: `${base}/artifact-pin-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ipcHandlers: new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>(),
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => sandboxHome };
});

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {},
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, payload?: unknown) => Promise<unknown>) => {
      ipcHandlers.set(channel, fn);
    },
    on: () => undefined,
  },
}));

import { pinArtifactToCanvas, setupArtifactIpc } from '../ipc';
import { createArtifact, getArtifact, listAllArtifactSummaries } from '../store';
import { readCanvasFull, writeCanvasFull } from '../../canvas/storage';

const canvasDir = join(sandboxHome, '.pulse-coder', 'canvas');

setupArtifactIpc();

const invoke = async <T>(channel: string, payload?: unknown): Promise<T> => {
  const handler = ipcHandlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return await handler({}, payload) as T;
};

const canvasNodes = async (workspaceId: string): Promise<Array<{ id: string; data?: Record<string, unknown> }>> => {
  const { data } = await readCanvasFull(workspaceId);
  return (data as { nodes?: Array<{ id: string; data?: Record<string, unknown> }> } | null)?.nodes ?? [];
};

describe('artifact pin lifecycle', () => {
  beforeEach(async () => {
    await fs.mkdir(canvasDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(sandboxHome, { recursive: true, force: true });
  });

  it('refuses to pin inside a sentinel storage scope', async () => {
    const artifact = await createArtifact('__global_chat__', { type: 'html', title: 'r', content: '<p>x</p>' });
    const result = await pinArtifactToCanvas('__global_chat__', artifact.id);
    expect(result).toHaveProperty('error');
    // No ghost canvas may appear under the sentinel directory.
    await expect(fs.access(join(canvasDir, '__global_chat__', 'canvas.json'))).rejects.toThrow();
  });

  it('re-pinning returns the existing live mirror instead of stacking a duplicate', async () => {
    const artifact = await createArtifact('ws-pin', { type: 'html', title: 'a', content: '<p>a</p>' });
    const first = await pinArtifactToCanvas('ws-pin', artifact.id);
    if ('error' in first) throw new Error(first.error);
    const second = await pinArtifactToCanvas('ws-pin', artifact.id);
    if ('error' in second) throw new Error(second.error);
    expect(second.nodeId).toBe(first.nodeId);
    const mirrors = (await canvasNodes('ws-pin')).filter((n) => n.data?.artifactId === artifact.id);
    expect(mirrors).toHaveLength(1);
  });

  it('clears a stale pinnedNodeId on read once the mirror node is gone', async () => {
    const artifact = await createArtifact('ws-repair', { type: 'html', title: 'b', content: '<p>b</p>' });
    const pin = await pinArtifactToCanvas('ws-repair', artifact.id);
    if ('error' in pin) throw new Error(pin.error);

    // Simulate the renderer deleting the node through a whole-canvas save.
    await writeCanvasFull('ws-repair', {
      nodes: [],
      edges: [],
      transform: { x: 0, y: 0, scale: 1 },
      savedAt: new Date().toISOString(),
    });

    const res = await invoke<{ ok: boolean; artifacts: Array<{ id: string; pinnedNodeId?: string }> }>(
      'artifact:list', { workspaceId: 'ws-repair' },
    );
    expect(res.ok).toBe(true);
    expect(res.artifacts.find((a) => a.id === artifact.id)?.pinnedNodeId).toBeUndefined();

    // With the slot cleared, pinning again succeeds with a fresh node.
    const repin = await pinArtifactToCanvas('ws-repair', artifact.id);
    if ('error' in repin) throw new Error(repin.error);
    expect(repin.nodeId).not.toBe(pin.nodeId);
  });

  it('deleting an artifact removes its canvas mirror node', async () => {
    const artifact = await createArtifact('ws-del', { type: 'html', title: 'c', content: '<p>c</p>' });
    const pin = await pinArtifactToCanvas('ws-del', artifact.id);
    if ('error' in pin) throw new Error(pin.error);
    expect((await canvasNodes('ws-del')).some((n) => n.id === pin.nodeId)).toBe(true);

    const res = await invoke<{ ok: boolean }>('artifact:delete', { workspaceId: 'ws-del', artifactId: artifact.id });
    expect(res.ok).toBe(true);
    expect((await canvasNodes('ws-del')).some((n) => n.id === pin.nodeId)).toBe(false);
    expect(await getArtifact('ws-del', artifact.id)).toBeNull();
  });
});

describe('listAllArtifactSummaries', () => {
  beforeEach(async () => {
    await fs.mkdir(canvasDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(sandboxHome, { recursive: true, force: true });
  });

  it('includes __global_chat__ but skips other __ and dot directories', async () => {
    await createArtifact('ws-a', { type: 'html', title: 'workspace artifact', content: '<p>1</p>' });
    await createArtifact('__global_chat__', { type: 'html', title: 'global artifact', content: '<p>2</p>' });
    // Manifest-style internal dir carrying an artifacts.json must stay hidden.
    await createArtifact('__internal__', { type: 'html', title: 'ghost', content: '<p>3</p>' });
    await createArtifact('.hidden', { type: 'html', title: 'dot ghost', content: '<p>4</p>' });

    const summaries = await listAllArtifactSummaries();
    const scopes = summaries.map((s) => s.workspaceId);
    expect(scopes).toContain('ws-a');
    expect(scopes).toContain('__global_chat__');
    expect(scopes).not.toContain('__internal__');
    expect(scopes).not.toContain('.hidden');
  });

  it('returns metadata only, never version contents', async () => {
    const artifact = await createArtifact('ws-meta', { type: 'svg', title: 'meta', content: '<svg/>' });
    const summaries = await listAllArtifactSummaries();
    const summary = summaries.find((s) => s.id === artifact.id);
    expect(summary).toMatchObject({ workspaceId: 'ws-meta', type: 'svg', title: 'meta', versionCount: 1 });
    expect(summary).not.toHaveProperty('versions');
    expect(JSON.stringify(summary)).not.toContain('<svg/>');
  });
});
