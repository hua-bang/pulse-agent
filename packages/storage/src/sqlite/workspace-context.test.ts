import Database from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PulseStorage } from '../contracts.js';
import { openSqliteStorage } from './index.js';

let root: string;
let path: string;
let storage: PulseStorage;

const register = (workspaceId = 'ws') => storage.canvas.commit({ workspaceId, expectedRevision: null, metadata: {} });
const deletion = async (workspaceId = 'ws') => {
  const bundle = (await storage.workspaces.readBundle(workspaceId))!;
  return {
    workspaceId, expectedCanvasRevision: bundle.canvas.revision,
    generation: storage.generation, expectedConversations: bundle.conversationState,
  };
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pulse-workspace-context-'));
  path = join(root, 'store.sqlite');
  storage = await openSqliteStorage({ path });
});
afterEach(async () => {
  await storage.close();
  await rm(root, { recursive: true, force: true });
});

describe('workspace context document', () => {
  it('creates, reads, and updates with revision checks and change entries', async () => {
    await register();
    expect(await storage.workspaceContext.read('ws')).toBeNull();
    const cursor = await storage.changes.latestCursor();

    const created = await storage.workspaceContext.commit({ workspaceId: 'ws', expectedRevision: null, content: '# Goal' });
    expect(await storage.workspaceContext.read('ws')).toEqual({
      generation: storage.generation, workspaceId: 'ws', revision: created.revision, content: '# Goal',
    });
    await expect(storage.workspaceContext.commit({ workspaceId: 'ws', expectedRevision: null, content: 'dup' }))
      .rejects.toMatchObject({ code: 'revision_conflict' });

    const updated = await storage.workspaceContext.commit({
      workspaceId: 'ws', expectedRevision: created.revision, content: '# Goal\nnext',
    });
    await expect(storage.workspaceContext.commit({
      workspaceId: 'ws', expectedRevision: created.revision, content: 'stale',
    })).rejects.toMatchObject({ code: 'revision_conflict' });
    expect((await storage.workspaceContext.read('ws'))?.content).toBe('# Goal\nnext');

    const changes = (await storage.changes.read({ cursor })).items;
    expect(changes.map(change => [change.domain, change.resourceId, change.revision, change.kind])).toEqual([
      ['workspace-context', 'ws', created.revision, 'updated'],
      ['workspace-context', 'ws', updated.revision, 'updated'],
    ]);
  });

  it('rejects writes for a workspace that is not registered in storage', async () => {
    await expect(storage.workspaceContext.commit({ workspaceId: 'missing', expectedRevision: null, content: 'x' }))
      .rejects.toMatchObject({ code: 'not_found' });
  });

  it('hides and freezes the document in the trash, and restore invalidates old revisions', async () => {
    await register();
    const created = await storage.workspaceContext.commit({ workspaceId: 'ws', expectedRevision: null, content: 'kept' });
    const trashed = await storage.workspaces.trashBundle(await deletion());

    expect(await storage.workspaceContext.read('ws')).toBeNull();
    await expect(storage.workspaceContext.commit({ workspaceId: 'ws', expectedRevision: created.revision, content: 'x' }))
      .rejects.toMatchObject({ code: 'not_found' });

    await storage.workspaces.restoreBundle('ws', trashed.revision, trashed.generation);
    const restored = (await storage.workspaceContext.read('ws'))!;
    expect(restored.content).toBe('kept');
    expect(restored.revision).toBeGreaterThan(created.revision);
    await expect(storage.workspaceContext.commit({ workspaceId: 'ws', expectedRevision: created.revision, content: 'x' }))
      .rejects.toMatchObject({ code: 'revision_conflict' });
  });

  it('is removed with its workspace and announces the removal', async () => {
    await register();
    await storage.workspaceContext.commit({ workspaceId: 'ws', expectedRevision: null, content: 'gone' });
    const cursor = await storage.changes.latestCursor();
    const bundle = (await storage.workspaces.readBundle('ws'))!;
    await storage.workspaces.removeBundle('ws', bundle.canvas.revision, storage.generation, bundle.conversationState);

    expect(await storage.workspaceContext.read('ws')).toBeNull();
    const changes = (await storage.changes.read({ cursor })).items;
    expect(changes.find(change => change.domain === 'workspace-context')).toMatchObject({ resourceId: 'ws', kind: 'removed' });
    expect(await storage.checkIntegrity()).toEqual({ ok: true, issues: [] });
  });

  it('upgrades a v3 store, keeping retained change cursors and never reusing sequences', async () => {
    await register();
    const cursor = await storage.changes.latestCursor();
    await register('second');
    const pruned = await register('third');
    await storage.close();

    // Rebuild the v3 shape: the old CHECK without the new domain, no context table.
    const old = new Database(path);
    const v3Check = "'canvas', 'conversation', 'conversation-scope'";
    old.exec(`
      DROP TABLE workspace_context;
      CREATE TABLE rv (domain TEXT NOT NULL CHECK (domain IN (${v3Check})), scope_id TEXT NOT NULL,
        resource_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK (revision > 0),
        PRIMARY KEY (domain, scope_id, resource_id)) STRICT;
      INSERT INTO rv SELECT * FROM resource_versions; DROP TABLE resource_versions; ALTER TABLE rv RENAME TO resource_versions;
      CREATE TABLE sc (sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        domain TEXT NOT NULL CHECK (domain IN (${v3Check})), scope_id TEXT NOT NULL, resource_id TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision > 0), kind TEXT NOT NULL CHECK (kind IN ('updated', 'removed')),
        changed_ids TEXT NOT NULL CHECK (json_valid(changed_ids))) STRICT;
      INSERT INTO sc SELECT * FROM storage_changes; DROP TABLE storage_changes; ALTER TABLE sc RENAME TO storage_changes;
    `);
    // The newest change was pruned; its sequence must still never be reissued.
    old.prepare('DELETE FROM storage_changes WHERE sequence = ?').run(Number(Buffer.from(pruned.changeCursor, 'base64url').toString()));
    old.pragma('user_version = 3');
    old.close();

    storage = await openSqliteStorage({ path });
    expect((await storage.changes.read({ cursor })).items.map(change => change.resourceId)).toEqual(['second']);
    await register('fourth');
    const created = await storage.workspaceContext.commit({ workspaceId: 'fourth', expectedRevision: null, content: 'v4' });
    const after = (await storage.changes.read({ cursor })).items;
    expect(after.map(change => change.resourceId)).toEqual(['second', 'fourth', 'fourth']);
    expect(Number(Buffer.from(after[1].cursor, 'base64url').toString()))
      .toBeGreaterThan(Number(Buffer.from(pruned.changeCursor, 'base64url').toString()));
    expect(created.revision).toBe(1);
    expect(await storage.checkIntegrity()).toEqual({ ok: true, issues: [] });
  });
});
