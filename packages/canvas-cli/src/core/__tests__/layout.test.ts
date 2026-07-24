import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readLayout, validateLayout, applyFrameGrid } from '../layout';
import { loadCanvas, getWorkspaceDir } from '../store';
import type { CanvasNode, CanvasSaveData } from '../types';

let testDir: string;
const wsId = 'ws-layout-test';

beforeEach(async () => {
  testDir = join(
    tmpdir(),
    `canvas-cli-layout-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  );
  await fs.mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

function node(id: string, type: string, rect: [number, number, number, number], title = id): CanvasNode {
  const [x, y, width, height] = rect;
  return { id, type, title, x, y, width, height, data: {}, updatedAt: 1 } as CanvasNode;
}

async function seedV1(nodes: CanvasNode[], edges: CanvasSaveData['edges'] = []): Promise<void> {
  const wsDir = getWorkspaceDir(wsId, testDir);
  await fs.mkdir(wsDir, { recursive: true });
  const canvas: CanvasSaveData = {
    nodes,
    edges,
    transform: { x: 0, y: 0, scale: 1 },
    savedAt: new Date().toISOString(),
  };
  await fs.writeFile(join(wsDir, 'canvas.json'), JSON.stringify(canvas));
}

describe('readLayout', () => {
  it('classifies frame children geometrically and reports bounds', async () => {
    await seedV1([
      node('f1', 'frame', [0, 0, 1000, 600]),
      node('a', 'file', [50, 50, 300, 200]),
      node('b', 'text', [400, 50, 300, 200]),
      node('free', 'file', [1500, 0, 300, 200]),
    ]);

    const res = await readLayout(wsId, testDir);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const frame = res.data.frames.find(f => f.id === 'f1');
    expect(frame?.childIds.sort()).toEqual(['a', 'b']);
    expect(res.data.freeNodes.map(n => n.id)).toEqual(['free']);
    expect(res.data.bounds).toEqual({ x: 0, y: 0, width: 1800, height: 600 });
  });

  it('assigns nested containment to the smallest frame', async () => {
    await seedV1([
      node('outer', 'frame', [0, 0, 2000, 1000]),
      node('inner', 'frame', [100, 100, 500, 400]),
      node('a', 'file', [150, 150, 200, 150]),
    ]);

    const res = await readLayout(wsId, testDir);
    if (!res.ok) throw new Error('read failed');
    expect(res.data.frames.find(f => f.id === 'inner')?.childIds).toEqual(['a']);
    expect(res.data.frames.find(f => f.id === 'outer')?.childIds).toEqual([]);
  });
});

describe('validateLayout', () => {
  it('flags stacked nodes, narrow cards, and frame straddling', async () => {
    await seedV1([
      node('f1', 'frame', [0, 0, 800, 600]),
      node('a', 'file', [50, 50, 300, 200]),
      node('b', 'file', [200, 100, 300, 200]),   // overlaps a
      node('narrow', 'text', [50, 400, 120, 100]), // < 240px
      node('straddler', 'file', [700, 50, 300, 200]), // center outside f1, intersects it
    ]);

    const res = await validateLayout(wsId, testDir);
    if (!res.ok) throw new Error('validate failed');
    const kinds = res.data.issues.map(i => i.kind);
    expect(kinds).toContain('overlap');
    expect(kinds).toContain('too_narrow');
    expect(kinds).toContain('straddles_frame');
    expect(res.data.ok).toBe(false);
  });

  it('flags an extreme single-row aspect ratio', async () => {
    await seedV1([
      node('a', 'file', [0, 0, 1200, 300]),
      node('b', 'file', [1300, 0, 1200, 300]),
      node('c', 'file', [2600, 0, 1200, 300]),
      node('d', 'file', [3900, 0, 1200, 300]),
    ]);
    const res = await validateLayout(wsId, testDir);
    if (!res.ok) throw new Error('validate failed');
    expect(res.data.issues.map(i => i.kind)).toContain('extreme_aspect_ratio');
  });

  it('passes a clean board', async () => {
    await seedV1([
      node('f1', 'frame', [0, 0, 800, 600]),
      node('a', 'file', [24, 24, 300, 200]),
      node('b', 'file', [360, 24, 300, 200]),
    ]);
    const res = await validateLayout(wsId, testDir);
    if (!res.ok) throw new Error('validate failed');
    expect(res.data.ok).toBe(true);
    expect(res.data.issues).toEqual([]);
  });
});

describe('applyFrameGrid', () => {
  it('arranges children into a non-overlapping grid and fits the frame', async () => {
    await seedV1([
      node('f1', 'frame', [100, 100, 400, 300]),
      // Deliberately stacked children in scrambled order.
      node('c', 'file', [120, 260, 300, 200]),
      node('a', 'file', [110, 110, 300, 200]),
      node('b', 'file', [130, 130, 300, 200]),
      node('d', 'text', [140, 140, 300, 150]),
    ]);

    const res = await applyFrameGrid(wsId, 'f1', { columns: 2 }, testDir);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.movedCount).toBe(4);

    // After arranging, the board must validate clean (no overlaps, all
    // children fully inside the resized frame).
    const check = await validateLayout(wsId, testDir);
    if (!check.ok) throw new Error('validate failed');
    expect(check.data.issues.filter(i => i.kind === 'overlap' || i.kind === 'overflows_frame')).toEqual([]);

    const canvas = await loadCanvas(wsId, testDir);
    const frame = canvas?.nodes.find(n => n.id === 'f1');
    // 2 columns of 300px + 16 gap + 2x24 padding = 664 wide.
    expect(frame?.width).toBe(664);
  });

  it('returns node_not_found for a missing frame', async () => {
    await seedV1([node('a', 'file', [0, 0, 300, 200])]);
    const res = await applyFrameGrid(wsId, 'nope', {}, testDir);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('node_not_found');
  });

  it('is a no-op on an empty frame', async () => {
    await seedV1([node('f1', 'frame', [0, 0, 400, 300])]);
    const res = await applyFrameGrid(wsId, 'f1', {}, testDir);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.movedCount).toBe(0);
  });
});
