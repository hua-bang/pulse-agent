import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PulseStorage } from '../contracts.js';
import { openSqliteStorage } from './index.js';

let directory: string;
let databasePath: string;
let storage: PulseStorage;
const connections: PulseStorage[] = [];

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'pulse-storage-canvas-'));
  databasePath = join(directory, 'storage.sqlite');
  storage = await openSqliteStorage({ path: databasePath });
  connections.push(storage);
});

afterEach(async () => {
  for (const connection of connections.splice(0)) await connection.close();
  await rm(directory, { recursive: true, force: true });
});

describe('SQLite canvas repository', () => {
  it('round-trips unknown payloads and keeps off-canvas atoms separate from placements', async () => {
    const plugin = {
      id: 'plugin',
      type: 'future-plugin',
      properties: { tags: ['research'], confidence: 0.8 },
      links: [{ relation: 'source', target: { workspaceId: 'elsewhere', nodeId: 'source' } }],
      data: { payload: { custom: ['value', 42, null, { future: true }] } },
    };
    const offCanvas = { id: 'off-canvas', data: { title: 'Library only' } };
    const placement = { id: 'plugin', x: 12, y: 24, width: 400, ref: { nodeId: 'plugin' } };
    const edge = { id: 'edge', source: { nodeId: 'plugin' }, target: { x: 90, y: 90 } };
    const receipt = await storage.canvas.commit({
      workspaceId: 'work',
      expectedRevision: null,
      metadata: { title: 'Workspace', transform: { x: 0, y: 0, scale: 1 } },
      nodes: { put: [plugin, offCanvas] },
      placements: { put: [placement] },
      edges: { put: [edge] },
    });

    expect(receipt.revision).toBe(1);
    expect(await storage.canvas.read('work')).toEqual({
      generation: storage.generation,
      workspaceId: 'work',
      revision: 1,
      metadata: { title: 'Workspace', transform: { x: 0, y: 0, scale: 1 } },
      nodes: [offCanvas, plugin],
      placements: [placement],
      edges: [edge],
    });
    expect(await storage.canvas.readNode('work', 'off-canvas')).toEqual(offCanvas);
    const changes = await storage.changes.read();
    expect(changes.items).toHaveLength(1);
    expect(changes.items[0]).toMatchObject({
      cursor: receipt.changeCursor,
      domain: 'canvas',
      scopeId: 'work',
      resourceId: 'work',
      revision: 1,
      kind: 'updated',
      changedIds: ['plugin', 'off-canvas', 'edge'],
    });

    await storage.canvas.commit({ workspaceId: 'work', expectedRevision: 1, placements: { remove: ['plugin'] } });
    const updated = await storage.canvas.read('work');
    expect(updated?.placements).toEqual([]);
    expect(updated?.nodes).toEqual([offCanvas, plugin]);
    expect(updated?.metadata.title).toBe('Workspace');
  });

  it('rejects a stale writer using a separate connection without losing the committed update', async () => {
    await storage.canvas.commit({ workspaceId: 'work', expectedRevision: null });
    const other = await openSqliteStorage({ path: databasePath });
    connections.push(other);
    const stale = await other.canvas.read('work');

    const receipt = await storage.canvas.commit({
      workspaceId: 'work', expectedRevision: 1, nodes: { put: [{ id: 'new', value: 'kept' }] },
    });
    await expect(other.canvas.commit({
      workspaceId: 'work', expectedRevision: stale!.revision, nodes: { put: [{ id: 'stale' }] },
    })).rejects.toMatchObject({ code: 'revision_conflict', expectedRevision: 1, actualRevision: 2 });

    expect(await other.canvas.read('work')).toMatchObject({ revision: 2, nodes: [{ id: 'new', value: 'kept' }] });
    expect(await storage.changes.latestCursor()).toBe(receipt.changeCursor);
    expect((await storage.changes.read()).items).toHaveLength(2);
  });

  it('rolls back records, revision and notification when SQL fails partway through a batch', async () => {
    await storage.canvas.commit({
      workspaceId: 'work', expectedRevision: null, metadata: { name: 'before' },
      nodes: { put: [{ id: 'node', value: 'before' }] },
    });
    const before = await storage.canvas.read('work');
    const cursor = await storage.changes.latestCursor();
    const fault = new Database(databasePath);
    try {
      fault.exec(`
        CREATE TRIGGER fail_edge BEFORE INSERT ON canvas_records
        WHEN NEW.collection = 'edge' AND NEW.id = 'reject'
        BEGIN SELECT RAISE(ABORT, 'injected edge failure'); END;
      `);
      await expect(storage.canvas.commit({
        workspaceId: 'work', expectedRevision: 1, metadata: { name: 'after' },
        nodes: { put: [{ id: 'node', value: 'after' }] },
        placements: { put: [{ id: 'placement', x: 3 }] },
        edges: { put: [{ id: 'reject' }] },
      })).rejects.toThrow();
      expect(await storage.canvas.read('work')).toEqual(before);
      expect(await storage.changes.latestCursor()).toBe(cursor);
      fault.exec('DROP TRIGGER fail_edge');
      const recovered = await storage.canvas.commit({
        workspaceId: 'work', expectedRevision: 1, nodes: { put: [{ id: 'node', value: 'recovered' }] },
      });
      expect(recovered.revision).toBe(2);
    } finally {
      fault.close();
    }
  });

  it.each([
    { put: [{ id: 'same' }, { id: 'same' }] },
    { put: [{ id: 'same' }], remove: ['same'] },
    { remove: ['same', 'same'] },
  ])('rejects duplicate and conflicting ids within a collection before any change: %j', async nodes => {
    await storage.canvas.commit({ workspaceId: 'work', expectedRevision: null });
    const cursor = await storage.changes.latestCursor();
    await expect(storage.canvas.commit({
      workspaceId: 'work', expectedRevision: 1, metadata: { changed: true }, nodes,
    })).rejects.toMatchObject({ code: 'invalid_argument' });
    expect(await storage.canvas.read('work')).toMatchObject({ revision: 1, metadata: {}, nodes: [] });
    expect(await storage.changes.latestCursor()).toBe(cursor);
  });

  it('does not commit an update or deletion when the change log cannot be written', async () => {
    await storage.canvas.commit({
      workspaceId: 'work', expectedRevision: null, nodes: { put: [{ id: 'node', value: 'before' }] },
    });
    const before = await storage.canvas.read('work');
    const cursor = await storage.changes.latestCursor();
    const fault = new Database(databasePath);
    try {
      fault.exec(`
        CREATE TRIGGER fail_notification BEFORE INSERT ON storage_changes
        BEGIN SELECT RAISE(ABORT, 'injected notification failure'); END;
      `);
      await expect(storage.canvas.commit({
        workspaceId: 'work', expectedRevision: 1, nodes: { put: [{ id: 'node', value: 'after' }] },
      })).rejects.toThrow();
      expect(await storage.canvas.read('work')).toEqual(before);
      await expect(storage.canvas.remove('work', 1)).rejects.toThrow();
      expect(await storage.canvas.read('work')).toEqual(before);
      expect(await storage.changes.latestCursor()).toBe(cursor);
    } finally {
      fault.close();
    }
  });

  it('isolates equal record ids by workspace and paginates workspaces and atoms', async () => {
    for (const workspaceId of ['c', 'a', 'b']) {
      await storage.canvas.commit({
        workspaceId, expectedRevision: null, metadata: { title: workspaceId },
        nodes: { put: ['n3', 'n1', 'n2'].map(id => ({ id, owner: workspaceId })) },
      });
    }
    const first = await storage.canvas.list({ limit: 2 });
    expect(first.items.map(item => item.workspaceId)).toEqual(['a', 'b']);
    expect(first.nextCursor).toBeDefined();
    const second = await storage.canvas.list({ cursor: first.nextCursor, limit: 2 });
    expect(second.items).toEqual([{ workspaceId: 'c', revision: 1, metadata: { title: 'c' } }]);
    expect(second.nextCursor).toBeUndefined();

    const nodePage = await storage.canvas.listNodes('a', { limit: 2 });
    expect(nodePage.items).toEqual([{ id: 'n1', owner: 'a' }, { id: 'n2', owner: 'a' }]);
    const remaining = await storage.canvas.listNodes('a', { cursor: nodePage.nextCursor, limit: 2 });
    expect(remaining.items).toEqual([{ id: 'n3', owner: 'a' }]);
    expect(remaining.nextCursor).toBeUndefined();
    expect(await storage.canvas.readNode('b', 'n1')).toEqual({ id: 'n1', owner: 'b' });
    expect(await storage.canvas.listNodes('missing')).toEqual({ items: [] });
    expect(await storage.canvas.read('missing')).toBeNull();
  });

  it('deletes one workspace and its records with a committed removal notification', async () => {
    for (const workspaceId of ['a', 'b']) {
      await storage.canvas.commit({
        workspaceId, expectedRevision: null,
        nodes: { put: [{ id: 'same' }] }, placements: { put: [{ id: 'same' }] }, edges: { put: [{ id: 'edge' }] },
      });
    }
    await expect(storage.canvas.remove('a', 2)).rejects.toMatchObject({ code: 'revision_conflict' });
    const receipt = await storage.canvas.remove('a', 1);
    expect(receipt.revision).toBe(2);
    expect(await storage.canvas.read('a')).toBeNull();
    expect(await storage.canvas.readNode('a', 'same')).toBeNull();
    expect(await storage.canvas.readNode('b', 'same')).toEqual({ id: 'same' });
    expect((await storage.changes.read()).items.at(-1)).toMatchObject({
      cursor: receipt.changeCursor, scopeId: 'a', resourceId: 'a', revision: 2, kind: 'removed',
    });
    await expect(storage.canvas.remove('a', 1)).rejects.toMatchObject({ code: 'revision_conflict', actualRevision: null });
  });

  it('requires explicit create semantics and validates ids, revisions and pagination', async () => {
    await expect(storage.canvas.commit({ workspaceId: 'absent', expectedRevision: 1 }))
      .rejects.toMatchObject({ code: 'revision_conflict', actualRevision: null });
    await storage.canvas.commit({ workspaceId: 'work', expectedRevision: null });
    await expect(storage.canvas.commit({ workspaceId: 'work', expectedRevision: null }))
      .rejects.toMatchObject({ code: 'revision_conflict', actualRevision: 1 });
    await expect(storage.canvas.read('')).rejects.toMatchObject({ code: 'invalid_argument' });
    await expect(storage.canvas.readNode('work', '')).rejects.toMatchObject({ code: 'invalid_argument' });
    await expect(storage.canvas.listNodes('')).rejects.toMatchObject({ code: 'invalid_argument' });
    await expect(storage.canvas.remove('', 1)).rejects.toMatchObject({ code: 'invalid_argument' });
    await expect(Reflect.apply(storage.canvas.remove, storage.canvas, ['missing', null]))
      .rejects.toMatchObject({ code: 'invalid_argument' });
    await expect(storage.canvas.commit({ workspaceId: 'work', expectedRevision: -1 }))
      .rejects.toMatchObject({ code: 'invalid_argument' });
    await expect(storage.canvas.commit({ workspaceId: 'work', expectedRevision: 0 }))
      .rejects.toMatchObject({ code: 'invalid_argument' });
    await expect(storage.canvas.list({ limit: 0 })).rejects.toMatchObject({ code: 'invalid_argument' });
    await expect(storage.canvas.listNodes('work', { limit: 501 })).rejects.toMatchObject({ code: 'invalid_argument' });
    await expect(storage.canvas.list({ cursor: '***' })).rejects.toMatchObject({ code: 'invalid_argument' });
    expect((await storage.canvas.read('work'))?.revision).toBe(1);
  });

  it('does not accept an old revision after a workspace is deleted and recreated', async () => {
    await storage.canvas.commit({
      workspaceId: 'work', expectedRevision: null, nodes: { put: [{ id: 'old' }] },
    });
    const old = await storage.canvas.read('work');
    const removed = await storage.canvas.remove('work', old!.revision);
    const recreated = await storage.canvas.commit({
      workspaceId: 'work', expectedRevision: null, nodes: { put: [{ id: 'new' }] },
    });
    expect(recreated.revision).toBeGreaterThan(removed.revision);
    await expect(storage.canvas.commit({
      workspaceId: 'work', expectedRevision: old!.revision, nodes: { put: [{ id: 'stale' }] },
    })).rejects.toMatchObject({ code: 'revision_conflict', actualRevision: recreated.revision });
    await expect(storage.canvas.remove('work', old!.revision))
      .rejects.toMatchObject({ code: 'revision_conflict', actualRevision: recreated.revision });
    expect((await storage.canvas.read('work'))?.nodes).toEqual([{ id: 'new' }]);
    expect(await storage.changes.latestCursor()).toBe(recreated.changeCursor);
  });
});
