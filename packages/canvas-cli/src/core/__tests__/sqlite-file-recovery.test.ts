import { promises as fs } from 'fs';
import { basename, join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activateLocalCanvasStorage, openLocalStorage } from '@pulse-coder/storage/local';
import { prepareLegacyCanvasImport } from '@pulse-coder/storage/canvas';
import { prepareLocalFileWrite } from '@pulse-coder/storage/local-files';
import type { PulseStorage } from '@pulse-coder/storage';
import * as store from '../store';
import * as fileWrites from '../sqlite-file-writes';
import { writeNode } from '../nodes';
import { applyPlan } from '../apply';
import { runDoctor } from '../doctor';

let root: string;
let pathA: string;
let pathB: string;
const workspaceId = 'work';

async function active<T>(fn: (storage: PulseStorage) => Promise<T>): Promise<T> {
  const storage = await openLocalStorage({ root });
  if (!storage) throw new Error('Fixture storage is not active');
  try { return await fn(storage); } finally { await storage.close(); }
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'canvas-cli-file-recovery-'));
  const directory = join(root, workspaceId, 'notes');
  await fs.mkdir(directory, { recursive: true });
  pathA = join(directory, 'a.md');
  pathB = join(directory, 'b.md');
  await fs.writeFile(pathA, 'Base A');
  await fs.writeFile(pathB, 'Base B');
  const storage = await activateLocalCanvasStorage({ root, loadLegacyWorkspaces: async () => [
    prepareLegacyCanvasImport(workspaceId, {
      nodes: [
        { id: 'a', type: 'file', x: 0, y: 0, width: 300, height: 200, data: { filePath: pathA, content: 'Base A' } },
        { id: 'b', type: 'file', x: 320, y: 0, width: 300, height: 200, data: { filePath: pathB, content: 'Base B' } },
      ], edges: [], transform: { x: 0, y: 0, scale: 1 }, savedAt: '2026-09-19T00:00:00Z',
    }),
  ] });
  await storage.close();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

describe('CLI durable file recovery', () => {
  it('leaves both the intent queue and Markdown untouched when the Canvas CAS fails', async () => {
    const stale = await store.loadCanvas(workspaceId, root);
    const current = await store.loadCanvas(workspaceId, root);
    current!.nodes[0].title = 'Newer metadata';
    await store.saveCanvas(workspaceId, current!, root);
    vi.spyOn(store, 'loadCanvas').mockResolvedValueOnce(stale);
    await expect(writeNode(workspaceId, 'a', 'Rejected', root)).rejects.toMatchObject({ code: 'revision_conflict' });
    expect(await fs.readFile(pathA, 'utf8')).toBe('Base A');
    expect(await active(storage => storage.fileWrites.list())).toMatchObject({ items: [] });
  });

  it('reports a durable file error and recovers after reopening without losing snapshots', async () => {
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(Object.assign(new Error('Injected unwritable target'), { code: 'EACCES' }));
    await expect(writeNode(workspaceId, 'a', 'Requested A', root))
      .rejects.toMatchObject({ code: 'file_write_pending', message: expect.stringContaining('(error)') });
    const queue = await active(storage => storage.fileWrites.list());
    expect(queue.items).toEqual([expect.objectContaining({
      status: 'error', baseContent: 'Base A', content: 'Requested A',
    })]);
    expect(await fs.readFile(pathA, 'utf8')).toBe('Base A');
    const diagnostic = await runDoctor(workspaceId, { storeDir: root });
    expect(diagnostic.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'file_write_error', intentId: queue.items[0].id, repairable: true }),
    ]));
    vi.restoreAllMocks();
    const repaired = await runDoctor(workspaceId, { storeDir: root, repair: true });
    expect(repaired.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ intentId: queue.items[0].id, fileWriteStatus: 'applied', repaired: true }),
    ]));
    expect(await fs.readFile(pathA, 'utf8')).toBe('Requested A');
    expect(await active(storage => storage.fileWrites.get(queue.items[0].id)))
      .toMatchObject({ status: 'applied', baseContent: 'Base A', content: 'Requested A' });
  });

  it('returns a complete current snapshot and revision after file acknowledgement advances the Canvas', async () => {
    const canvas = (await store.loadCanvas(workspaceId, root))!;
    canvas.nodes[0].data.content = 'New A';
    const intent = await prepareLocalFileWrite(pathA, 'a', 'New A');
    await store.saveCanvas(workspaceId, canvas, root, { fileWrites: [intent] });
    const stored = (await store.loadCanvas(workspaceId, root))!;
    expect(canvas).toEqual(stored);
    expect(canvas.revision).toBe(3);
    expect(canvas.nodes[0].data).toMatchObject({ saved: true, modified: false, fileWriteStatus: 'applied' });
  });

  it('coalesces repeated writes in one plan to the final content and reports the acknowledged revision', async () => {
    const result = await applyPlan(workspaceId, { baseRevision: 1, operations: [
      { action: 'update', id: 'a', content: 'Intermediate' },
      { action: 'update', id: 'a', content: 'Final' },
    ] }, { storeDir: root });
    expect(result.ok).toBe(true);
    expect(await fs.readFile(pathA, 'utf8')).toBe('Final');
    const queue = await active(storage => storage.fileWrites.list());
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]).toMatchObject({ baseContent: 'Base A', content: 'Final', status: 'applied' });
    if (!result.ok) throw new Error(result.error);
    expect(result.data.revision).toBe((await store.loadCanvas(workspaceId, root))!.revision);
  });

  it('recovers a plan interrupted after its Canvas and intents committed but before file effects', async () => {
    vi.spyOn(fileWrites, 'recoverSubmittedFileWrites').mockRejectedValueOnce(new Error('Injected process interruption'));
    await expect(applyPlan(workspaceId, { operations: [
      { action: 'update', id: 'a', content: 'New A' },
      { action: 'update', id: 'b', content: 'New B' },
    ] }, { storeDir: root })).rejects.toThrow('Injected process interruption');
    expect(await fs.readFile(pathA, 'utf8')).toBe('Base A');
    expect(await fs.readFile(pathB, 'utf8')).toBe('Base B');
    expect((await active(storage => storage.fileWrites.list())).items.map(write => write.status)).toEqual(['pending', 'pending']);
    vi.restoreAllMocks();
    const repaired = await runDoctor(workspaceId, { storeDir: root, repair: true });
    expect(repaired.repairedCount).toBe(2);
    expect(await fs.readFile(pathA, 'utf8')).toBe('New A');
    expect(await fs.readFile(pathB, 'utf8')).toBe('New B');
  });

  it('finishes a partially applied plan without rewriting already applied files', async () => {
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (basename(String(to)) === 'b.md') throw new Error('Injected second-file failure');
      return rename(from, to);
    });
    await expect(applyPlan(workspaceId, { operations: [
      { action: 'update', id: 'a', content: 'New A' },
      { action: 'update', id: 'b', content: 'New B' },
    ] }, { storeDir: root })).rejects.toMatchObject({ code: 'file_write_pending' });
    expect(await fs.readFile(pathA, 'utf8')).toBe('New A');
    expect(await fs.readFile(pathB, 'utf8')).toBe('Base B');
    vi.restoreAllMocks();
    const recoveredRenames = vi.spyOn(fs, 'rename');
    await runDoctor(workspaceId, { storeDir: root, repair: true });
    expect(recoveredRenames.mock.calls.map(([, to]) => basename(String(to)))).toEqual(['b.md']);
    expect(await fs.readFile(pathB, 'utf8')).toBe('New B');
  });

  it('preserves external edits and requested snapshots instead of repairing a conflict by overwrite', async () => {
    const prepare = fileWrites.prepareCanvasFileWrites;
    vi.spyOn(fileWrites, 'prepareCanvasFileWrites').mockImplementationOnce(async (...args) => {
      const intents = await prepare(...args);
      await fs.writeFile(pathA, 'External edit');
      return intents;
    });
    await expect(writeNode(workspaceId, 'a', 'Requested A', root)).rejects.toMatchObject({ code: 'file_write_conflict' });
    const queue = await active(storage => storage.fileWrites.list());
    expect(queue.items[0]).toMatchObject({ status: 'conflict', baseContent: 'Base A', content: 'Requested A' });
    const report = await runDoctor(workspaceId, { storeDir: root, repair: true });
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'file_write_conflict', intentId: queue.items[0].id, repairable: false }),
    ]));
    expect(await fs.readFile(pathA, 'utf8')).toBe('External edit');
    expect((await store.loadCanvas(workspaceId, root))!.nodes[0].data.content).toBe('Requested A');
  });

  it('rejects a batch writing one URI through multiple nodes before committing anything', async () => {
    const canvas = (await store.loadCanvas(workspaceId, root))!;
    canvas.nodes[1].data.filePath = pathA;
    await store.saveCanvas(workspaceId, canvas, root);
    const revision = canvas.revision;
    await expect(applyPlan(workspaceId, { operations: [
      { action: 'update', id: 'a', content: 'A change' },
      { action: 'update', id: 'b', content: 'B change' },
    ] }, { storeDir: root })).rejects.toMatchObject({ code: 'invalid_argument' });
    expect(await fs.readFile(pathA, 'utf8')).toBe('Base A');
    expect((await store.loadCanvas(workspaceId, root))!.revision).toBe(revision);
    expect((await active(storage => storage.fileWrites.list())).items).toEqual([]);
  });

  it('does not manufacture missing Markdown from its cached index', async () => {
    await fs.unlink(pathA);
    const canvas = (await store.loadCanvas(workspaceId, root))!;
    delete canvas.nodes[1].data.filePath;
    await store.saveCanvas(workspaceId, canvas, root);
    const report = await runDoctor(workspaceId, { storeDir: root, repair: true });
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'missing_backing_file', nodeId: 'a', repairable: false }),
      expect.objectContaining({ kind: 'missing_backing_file', nodeId: 'b', repairable: false }),
    ]));
    await expect(fs.access(pathA)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await store.loadCanvas(workspaceId, root))!.nodes[0].data.content).toBe('Base A');
  });

  it('does not run pending file effects when database integrity is broken', async () => {
    const write = await prepareLocalFileWrite(pathA, 'a', 'Do not write');
    await active(async storage => {
      await storage.canvas.commit({
        workspaceId, expectedRevision: 1,
        nodes: { put: [{ id: 'a', type: 'file', data: { filePath: pathA, content: write.content } }] },
        fileWrites: [write],
      });
    });
    const broken = new Database(join(root, '__storage__.sqlite'));
    try {
      broken.pragma('ignore_check_constraints = ON');
      broken.prepare('UPDATE workspaces SET metadata = ? WHERE id = ?').run('{broken', workspaceId);
    } finally {
      broken.close();
    }
    await expect(runDoctor(workspaceId, { storeDir: root, repair: true })).rejects.toMatchObject({ code: 'corrupt_data' });
    expect(await fs.readFile(pathA, 'utf8')).toBe('Base A');
  });
});
