import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openSqliteStorage, type SqliteStorage } from './index.js';

let root: string;
let path: string;
let storage: SqliteStorage;

const manifest = {
  workspaces: [
    { id: 'a', name: 'Alpha', rootFolder: '/tmp/alpha', folderId: 'f1', pluginField: { keep: [1, 2] } },
    { id: 'b', name: 'Beta' },
  ],
  folders: [{ id: 'f1', name: 'Folder', collapsed: true, extra: 'kept' }],
  activeId: 'a',
  futureTopLevel: { nested: true },
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pulse-workspace-manifest-'));
  path = join(root, 'store.sqlite');
  storage = await openSqliteStorage({ path });
});

afterEach(async () => {
  await storage.close();
  await rm(root, { recursive: true, force: true });
});

describe('workspace manifest repository', () => {
  it('is empty until created and round-trips unknown fields across reopen', async () => {
    expect(await storage.workspaceManifest.read()).toBeNull();
    const receipt = await storage.workspaceManifest.commit({ expectedRevision: null, manifest });
    expect(receipt).toMatchObject({ generation: storage.generation, revision: 1 });
    await storage.close();
    storage = await openSqliteStorage({ path });
    expect(await storage.workspaceManifest.read()).toEqual({ generation: storage.generation, revision: 1, manifest });
  });

  it('rejects stale revisions, a second create, and another generation', async () => {
    await storage.workspaceManifest.commit({ expectedRevision: null, manifest });
    await expect(storage.workspaceManifest.commit({ expectedRevision: null, manifest }))
      .rejects.toMatchObject({ code: 'revision_conflict', actualRevision: 1 });
    const second = await storage.workspaceManifest.commit({ expectedRevision: 1, manifest: { ...manifest, activeId: 'b' } });
    expect(second.revision).toBe(2);
    await expect(storage.workspaceManifest.commit({ expectedRevision: 1, manifest: { workspaces: [] } }))
      .rejects.toMatchObject({ code: 'revision_conflict', expectedRevision: 1, actualRevision: 2 });
    await expect(storage.workspaceManifest.commit({
      expectedRevision: 2, expectedGeneration: 'another-store', manifest: { workspaces: [] },
    })).rejects.toMatchObject({ code: 'revision_conflict' });
    expect((await storage.workspaceManifest.read())?.manifest.activeId).toBe('b');
  });

  it('rejects non-object and non-JSON manifests without a change', async () => {
    const cursor = await storage.changes.latestCursor();
    for (const value of [null, [], 'text', { bad: Number.NaN }]) {
      await expect(storage.workspaceManifest.commit({ expectedRevision: null, manifest: value as never }))
        .rejects.toMatchObject({ code: 'invalid_argument' });
    }
    expect(await storage.workspaceManifest.read()).toBeNull();
    expect((await storage.changes.read({ cursor })).items).toEqual([]);
  });

  it('logs one change per commit with the entry ids that changed', async () => {
    const cursor = await storage.changes.latestCursor();
    await storage.workspaceManifest.commit({ expectedRevision: null, manifest });
    await storage.workspaceManifest.commit({
      expectedRevision: 1,
      manifest: { ...manifest, workspaces: [{ id: 'b', name: 'Beta' }, { id: 'a', name: 'Renamed' }, { id: 'c', name: 'New' }] },
    });
    await storage.workspaceManifest.commit({
      expectedRevision: 2,
      manifest: { ...manifest, workspaces: [{ id: 'a', name: 'Renamed' }, { id: 'c', name: 'New' }], activeId: 'c' },
    });
    const changes = (await storage.changes.read({ cursor })).items;
    expect(changes.map(change => ({ ...change, cursor: undefined }))).toEqual([
      { cursor: undefined, domain: 'workspace-manifest', scopeId: 'local', resourceId: 'workspace-manifest', revision: 1, kind: 'updated', changedIds: ['a', 'b'] },
      { cursor: undefined, domain: 'workspace-manifest', scopeId: 'local', resourceId: 'workspace-manifest', revision: 2, kind: 'updated', changedIds: ['a', 'c'] },
      { cursor: undefined, domain: 'workspace-manifest', scopeId: 'local', resourceId: 'workspace-manifest', revision: 3, kind: 'updated', changedIds: ['b'] },
    ]);
  });
});
