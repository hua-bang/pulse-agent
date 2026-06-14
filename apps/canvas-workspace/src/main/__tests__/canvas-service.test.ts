import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const { broadcasts } = vi.hoisted(() => ({
  broadcasts: [] as Array<{ channel: string; payload: unknown }>,
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          send: (channel: string, payload: unknown) => {
            broadcasts.push({ channel, payload });
          },
        },
      },
    ],
  },
}));

import {
  appendImageNodeToCanvas,
  saveCanvas,
} from '../canvas/service';
import {
  readCanvasFull,
  writeCanvasFull,
  type CanvasSaveData,
} from '../canvas/storage';

let root: string;

beforeEach(async () => {
  broadcasts.length = 0;
  root = await fs.mkdtemp(join(tmpdir(), 'canvas-service-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const baseCanvas = (): CanvasSaveData => ({
  nodes: [
    {
      id: 'n-text',
      type: 'text',
      title: 'Existing',
      x: 10,
      y: 25,
      width: 100,
      height: 80,
      data: { content: 'hello' },
      updatedAt: 100,
    },
  ],
  edges: [],
  transform: { x: 0, y: 0, scale: 1 },
  savedAt: '2026-01-01T00:00:00.000Z',
});

describe('canvas service facade', () => {
  it('appends image nodes through shared storage and broadcast behavior', async () => {
    const workspaceId = 'ws-image';
    await writeCanvasFull(workspaceId, baseCanvas(), root);

    const result = await appendImageNodeToCanvas({
      workspaceId,
      imagePath: '/tmp/source-image.png',
      title: '  ',
      root,
    });

    expect(result.nodeId).toMatch(/^node-\d+-[a-z0-9]+$/);
    const { data } = await readCanvasFull(workspaceId, root);
    expect(data?.nodes).toHaveLength(2);
    const image = data?.nodes?.find((node) => node.id === result.nodeId);
    expect(image).toMatchObject({
      type: 'image',
      title: 'source-image.png',
      x: 150,
      y: 25,
      width: 480,
      height: 360,
      data: { filePath: '/tmp/source-image.png' },
    });
    expect(typeof image?.updatedAt).toBe('number');
    expect(broadcasts).toEqual([
      {
        channel: 'canvas:external-update',
        payload: {
          workspaceId,
          nodeIds: [result.nodeId],
          kind: 'create',
          source: 'canvas-agent',
        },
      },
    ]);
  });

  it('keeps the empty-node overwrite guard on facade saves', async () => {
    const workspaceId = 'ws-guard';
    await writeCanvasFull(workspaceId, baseCanvas(), root);

    await expect(
      saveCanvas(
        workspaceId,
        { nodes: [], edges: [], transform: { x: 0, y: 0, scale: 1 }, savedAt: '' },
        { root },
      ),
    ).rejects.toThrow('refusing to overwrite 1 on-disk nodes');

    await saveCanvas(
      workspaceId,
      { nodes: [], edges: [], transform: { x: 0, y: 0, scale: 1 }, savedAt: '' },
      { root, allowEmpty: true },
    );
    const { data } = await readCanvasFull(workspaceId, root);
    expect(data?.nodes).toEqual([]);
  });
});
