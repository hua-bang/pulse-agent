import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));

import { writeCanvasFull } from '../storage';
import { activateCanvasSqlite } from '../persistence/activate-sqlite';
import { closeCanvasStorage } from '../persistence/backend';
import { readCanvasSummaries, summarizeCanvasData } from '../summary';

const listTree = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { recursive: true });
  return entries.map(String).sort();
};

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'canvas-summary-')); });
afterEach(async () => {
  await closeCanvasStorage();
  await rm(root, { recursive: true, force: true });
});

describe('summarizeCanvasData', () => {
  it('counts every node and keeps the first six sized non-frame boxes', () => {
    const nodes = [
      { id: 'f', type: 'frame', x: 0, y: 0, width: 900, height: 600 },
      { id: 'z', type: 'text', x: 0, y: 0, width: 0, height: 10 },
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `n${index}`, type: 'text', x: index * 10, y: 5, width: 100, height: 50, data: { content: 'x' },
      })),
    ];
    const summary = summarizeCanvasData({ nodes });
    expect(summary?.nodeCount).toBe(10);
    expect(summary?.boxes).toHaveLength(6);
    expect(summary?.boxes[0]).toEqual({ type: 'text', title: 'x', x: 0, y: 5, width: 100, height: 50 });
  });

  it('labels a text box with the first line of its content, not its placeholder title', () => {
    const summary = summarizeCanvasData({
      nodes: [{
        id: 't', type: 'text', title: 'Text', x: 0, y: 0, width: 10, height: 10,
        data: { content: '<p></p><p>当前策略：&nbsp;找 5 个人</p><p>second</p>' },
      }],
    });
    expect(summary?.boxes[0].title).toBe('当前策略： 找 5 个人');
  });

  it('keeps a shortened title so the preview can show what each card is', () => {
    const long = 'x'.repeat(80);
    const summary = summarizeCanvasData({
      nodes: [
        { id: 'a', type: 'file', title: '  Pricing notes ', x: 0, y: 0, width: 10, height: 10 },
        { id: 'b', type: 'file', title: long, x: 0, y: 0, width: 10, height: 10 },
      ],
    });
    expect(summary?.boxes.map((box) => box.title)).toEqual(['Pricing notes', 'x'.repeat(60)]);
  });

  it('returns null for missing data', () => {
    expect(summarizeCanvasData(null)).toBeNull();
  });
});

describe('readCanvasSummaries', () => {
  it('reads JSON canvases without writing, migrating, or reading unsafe ids', async () => {
    await writeCanvasFull('ws', {
      nodes: [{ id: 'a', type: 'text', x: 1, y: 2, width: 30, height: 40, data: { content: 'hi' } }],
      transform: { x: 0, y: 0, scale: 1 },
      savedAt: '2026-10-01T00:00:00.000Z',
    }, root);
    const before = await listTree(root);

    const summaries = await readCanvasSummaries(['ws', 'missing', '../escape'], root);

    expect(summaries).toEqual({
      ws: {
        nodeCount: 1,
        boxes: [{ type: 'text', x: 1, y: 2, width: 30, height: 40 }],
      },
      missing: { nodeCount: 0, boxes: [] },
    });
    expect(await listTree(root)).toEqual(before);
  });

  it('returns null when a stored canvas cannot be parsed', async () => {
    await mkdir(join(root, 'broken'), { recursive: true });
    await writeFile(join(root, 'broken', 'canvas.json'), '{not json');

    expect(await readCanvasSummaries(['broken'], root)).toEqual({ broken: null });
  });

  it('reads SQLite canvases once the backend is active', async () => {
    await writeCanvasFull('ws', {
      nodes: [{ id: 'a', type: 'text', x: 1, y: 2, width: 30, height: 40, data: { content: 'hi' } }],
    }, root);
    await activateCanvasSqlite(root);

    const summaries = await readCanvasSummaries(['ws'], root);

    expect(summaries.ws?.nodeCount).toBe(1);
    // SQLite keeps node data, so the text box carries its content line.
    expect(summaries.ws?.boxes).toEqual([{ type: 'text', title: 'hi', x: 1, y: 2, width: 30, height: 40 }]);
  });
});
