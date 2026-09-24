import { cp, mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({ showMessageBox: vi.fn() }));
vi.mock('electron', () => ({ dialog: { showMessageBox: electron.showMessageBox } }));

import { activateCanvasSqlite, activateCanvasSqliteAtStartup } from './activate-sqlite';
import { arbitrateLegacyNode } from './legacy-node-arbitration';
import { closeCanvasStorage, getLocalCanvasStorage } from './backend';
import { migrateToV2, readCanvasFull } from '../storage';
import { createCanvasCompatibilityStore } from '@pulse-coder/storage/canvas';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'canvas-legacy-conflicts-'));
  await mkdir(join(root, 'ws', 'nodes'), { recursive: true });
  electron.showMessageBox.mockReset().mockResolvedValue({ response: 0 });
});
afterEach(async () => {
  await closeCanvasStorage();
  await rm(root, { recursive: true, force: true });
});

const inline = (data: Record<string, unknown>, updatedAt?: number) => ({
  id: 'n', type: 'text', title: 'Inline', x: 1, y: 2, data, ...(updatedAt === undefined ? {} : { updatedAt }),
});
const atom = (data: Record<string, unknown>, updatedAt?: number) => ({
  schemaVersion: 1, id: 'n', type: 'text', title: 'Atom', data, createdAt: 1, ...(updatedAt === undefined ? {} : { updatedAt }),
});

async function seed(dir: string, canvasNode: unknown, atomRecord: unknown): Promise<{ layout: string; file: string }> {
  const layout = `${JSON.stringify({ nodes: [canvasNode], edges: [] }, null, 2)}\n`;
  const file = `${JSON.stringify(atomRecord, null, 2)}\n`;
  await writeFile(join(dir, 'ws', 'canvas.json'), layout);
  await writeFile(join(dir, 'ws', 'nodes', 'n.json'), file);
  return { layout, file };
}

async function sqlNode(dir: string) {
  const storage = (await getLocalCanvasStorage(dir))!;
  return (await createCanvasCompatibilityStore(storage.canvas).readCanvas('ws'))!.nodes![0];
}

describe('v1 canvas.json beside divergent v2 node files', () => {
  it.each([
    ['newer node file', inline({ content: 'inline' }, 5), atom({ content: 'file' }, 9), 'node-file', 'node-file-newer', 'file'],
    ['newer canvas.json', inline({ content: 'inline' }, 9), atom({ content: 'file' }, 5), 'canvas.json', 'canvas-newer', 'inline'],
    ['equal timestamps', inline({ content: 'inline' }, 5), atom({ content: 'file' }, 5), 'canvas.json', 'canvas-default', 'inline'],
    ['missing timestamps', inline({ content: 'inline' }), atom({ content: 'file' }), 'canvas.json', 'canvas-default', 'inline'],
    ['empty inline body', inline({}, 9), atom({ content: 'file' }, 5), 'node-file', 'empty-inline-data', 'file'],
  ])('migrates instead of stopping: %s', async (_case, canvasNode, atomRecord, kept, reason, content) => {
    const { layout, file } = await seed(root, canvasNode, atomRecord);
    const conflicts = await activateCanvasSqlite(root);
    expect(conflicts).toEqual([expect.objectContaining({ workspaceId: 'ws', nodeId: 'n', kept, reason })]);
    const node = await sqlNode(root);
    expect(node.data).toEqual({ content });
    expect(node.title).toBe(kept === 'node-file' ? 'Atom' : 'Inline');
    expect(node.createdAt).toBe(1);
    expect(await readFile(join(root, 'ws', 'canvas.json'), 'utf8')).toBe(layout);
    expect(await readFile(join(root, 'ws', 'nodes', 'n.json'), 'utf8')).toBe(file);
    const records = (await readdir(join(root, '__storage-backup__'))).filter(name => name.startsWith('canvas-conflicts-'));
    expect(records).toHaveLength(1);
    const record = JSON.parse(await readFile(join(root, '__storage-backup__', records[0]), 'utf8'));
    expect(record.conflicts[0].canvas.data).toEqual((canvasNode as { data: unknown }).data);
    expect(record.conflicts[0].nodeFile.data).toEqual((atomRecord as { data: unknown }).data);
  });

  it.each([
    ['newer node file', inline({ content: 'inline' }, 5), atom({ content: 'file' }, 9)],
    ['newer canvas.json', inline({ content: 'inline' }, 9), atom({ content: 'file' }, 5)],
    ['equal timestamps', inline({ content: 'inline' }, 5), atom({ content: 'file' }, 5)],
  ])('shows the same node content the v1→v2 migration would show: %s', async (_case, canvasNode, atomRecord) => {
    const legacyRoot = await mkdtemp(join(tmpdir(), 'canvas-legacy-parity-'));
    try {
      await seed(root, canvasNode, atomRecord);
      await cp(join(root, 'ws'), join(legacyRoot, 'ws'), { recursive: true });
      await migrateToV2('ws', { root: legacyRoot });
      const legacy = (await readCanvasFull('ws', legacyRoot)).data!.nodes![0];
      await activateCanvasSqlite(root);
      const migrated = await sqlNode(root);
      expect({ type: migrated.type, title: migrated.title, data: migrated.data })
        .toEqual({ type: legacy.type, title: legacy.title, data: legacy.data });
    } finally {
      await rm(legacyRoot, { recursive: true, force: true });
    }
  });

  it('leaves identical copies alone and reports nothing', async () => {
    await seed(root, inline({ content: 'same' }, 5), { ...atom({ content: 'same' }, 5), title: 'Inline' });
    expect(await activateCanvasSqlite(root)).toEqual([]);
    const backups = await readdir(join(root, '__storage-backup__'));
    expect(backups.filter(name => name.startsWith('canvas-conflicts-'))).toEqual([]);
  });

  it('logs and announces resolved conflicts at startup without waiting for the notice', async () => {
    await seed(root, inline({ content: 'inline' }, 5), atom({ content: 'file' }, 9));
    electron.showMessageBox.mockReturnValueOnce(new Promise(() => undefined));
    const writeLog = vi.fn();
    await activateCanvasSqliteAtStartup(writeLog, root);
    expect(writeLog).toHaveBeenCalledWith('storage', 'Resolved divergent legacy node copies',
      JSON.stringify([{ workspaceId: 'ws', nodeId: 'n', kept: 'node-file', reason: 'node-file-newer' }]));
    expect(electron.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      type: 'warning', detail: expect.stringContaining('ws'),
    }));
  });
});

describe('arbitrateLegacyNode', () => {
  it('drops content fields the winning node file does not have', () => {
    const result = arbitrateLegacyNode('ws', { id: 'n', type: 'text', data: {}, properties: { a: 1 }, updatedAt: 1 }, {
      id: 'n', type: 'text', data: { content: 'file' }, updatedAt: 2,
    });
    expect(result.node).toEqual({ id: 'n', type: 'text', data: { content: 'file' }, updatedAt: 2 });
    expect(result.conflict).toMatchObject({ kept: 'node-file', canvas: { data: {} }, nodeFile: { data: { content: 'file' } } });
  });
});
