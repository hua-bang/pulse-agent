import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PulseStorage } from '../contracts.js';
import type { FileWriteInput } from '../file-contracts.js';
import { openSqliteStorage } from './index.js';

let storage: PulseStorage;
const hash = (content: string) => `sha256:${createHash('sha256').update(content).digest('hex')}`;
const intent = (id = 'write-1', content = 'target'): FileWriteInput => ({
  id, nodeId: 'note', uri: 'file:///fixture/note.md',
  baseVersion: hash('base'), targetVersion: hash(content), baseContent: 'base', content,
});

async function stage(write: FileWriteInput, workspaceId = 'work'): Promise<void> {
  const previous = await storage.canvas.read(workspaceId);
  await storage.canvas.commit({
    workspaceId, expectedRevision: previous?.revision ?? null,
    nodes: { put: [{ id: write.nodeId, type: 'file', data: { filePath: '/fixture/note.md', content: write.content } }] },
    fileWrites: [write],
  });
}

beforeEach(async () => { storage = await openSqliteStorage({ path: ':memory:' }); });
afterEach(async () => { await storage.close(); });

describe('transactional file write intents', () => {
  it('stores recovery snapshots and exposes pending index state in the Canvas transaction', async () => {
    const write = intent();
    await stage(write);
    expect(await storage.fileWrites.get(write.id)).toEqual({ ...write, workspaceId: 'work', status: 'pending' });
    expect(await storage.canvas.readNode('work', 'note')).toMatchObject({ data: {
      content: 'target', fileWriteIntentId: write.id, fileWriteStatus: 'pending', saved: false, modified: true,
    } });
    expect((await storage.fileWrites.list({ workspaceId: 'work', statuses: ['pending'] })).items).toHaveLength(1);
    const result = await storage.fileWrites.settle(write.id, { status: 'applied' });
    expect(result.canvasCommit).toMatchObject({ generation: storage.generation, revision: 2 });
    expect(await storage.canvas.readNode('work', 'note')).toMatchObject({ data: {
      content: 'target', fileWriteStatus: 'applied', saved: true, modified: false,
    } });
    expect(await storage.fileWrites.get(write.id)).toMatchObject({ baseContent: 'base', content: 'target', status: 'applied' });
    const cursor = await storage.changes.latestCursor();
    await storage.fileWrites.settle(write.id, { status: 'error', error: 'late duplicate outcome' });
    expect(await storage.changes.latestCursor()).toBe(cursor);
    expect((await storage.fileWrites.get(write.id))?.status).toBe('applied');
  });

  it('rejects mismatched content hashes and rolls back records and intent staging together', async () => {
    await expect(stage({ ...intent(), targetVersion: hash('different') }))
      .rejects.toMatchObject({ code: 'invalid_argument' });
    await expect(stage({ ...intent(), baseVersion: null }))
      .rejects.toMatchObject({ code: 'invalid_argument' });
    expect(await storage.canvas.read('work')).toBeNull();
    expect((await storage.fileWrites.list()).items).toEqual([]);
    expect((await storage.changes.read()).items).toEqual([]);
  });

  it('does not mark a newer intent or changed content as saved when an older write is acknowledged', async () => {
    await stage(intent('older', 'one'));
    await stage(intent('newer', 'two'));
    const revision = (await storage.canvas.read('work'))!.revision;
    const oldResult = await storage.fileWrites.settle('older', { status: 'applied' });
    expect(oldResult.canvasCommit).toBeUndefined();
    expect((await storage.canvas.read('work'))!.revision).toBe(revision);
    expect(await storage.canvas.readNode('work', 'note')).toMatchObject({ data: {
      content: 'two', fileWriteIntentId: 'newer', fileWriteStatus: 'pending', saved: false,
    } });
    const current = (await storage.canvas.readNode('work', 'note'))!;
    await storage.canvas.commit({
      workspaceId: 'work', expectedRevision: revision,
      nodes: { put: [{ ...current, data: { ...(current.data as object), content: 'Edited again' } }] },
    });
    expect((await storage.fileWrites.settle('newer', { status: 'applied' })).canvasCommit).toBeUndefined();
    expect(await storage.canvas.readNode('work', 'note')).toMatchObject({ data: { content: 'Edited again', saved: false } });
  });

  it('does not mark a node saved after its file binding changes', async () => {
    await stage(intent());
    const current = (await storage.canvas.readNode('work', 'note'))!;
    await storage.canvas.commit({
      workspaceId: 'work', expectedRevision: 1,
      nodes: { put: [{ ...current, data: { ...(current.data as object), filePath: '/fixture/other.md' } }] },
    });
    expect((await storage.fileWrites.settle('write-1', { status: 'applied' })).canvasCommit).toBeUndefined();
    expect(await storage.canvas.readNode('work', 'note')).toMatchObject({ data: { saved: false, filePath: '/fixture/other.md' } });
  });

  it('paginates the durable queue and isolates workspace and status filters', async () => {
    await stage(intent('first'), 'a');
    await stage(intent('second'), 'b');
    await stage(intent('third'), 'c');
    await storage.fileWrites.settle('second', { status: 'conflict', error: 'External edit' });
    const first = await storage.fileWrites.list({ limit: 2 });
    expect(first.items.map(item => item.id)).toEqual(['first', 'second']);
    const rest = await storage.fileWrites.list({ limit: 2, cursor: first.nextCursor });
    expect(rest.items.map(item => item.id)).toEqual(['third']);
    expect(rest.nextCursor).toBeUndefined();
    expect((await storage.fileWrites.list({ workspaceId: 'b', statuses: ['conflict'] })).items)
      .toEqual([expect.objectContaining({ id: 'second', error: 'External edit' })]);
    expect((await storage.fileWrites.list({ statuses: ['pending'] })).items.map(item => item.id)).toEqual(['first', 'third']);
  });
});
