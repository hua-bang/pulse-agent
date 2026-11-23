import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JsonObject } from './contracts.js';
import {
  activateLocalCanvasStorage,
  readLocalWorkspaceManifest,
  updateLocalWorkspaceManifest,
  withLegacyCanvasWrite,
  type LocalWorkspaceManifestOptions,
} from './local.js';
import { openSqliteStorage, type SqliteStorage } from './sqlite/index.js';

let root: string;
let storage: SqliteStorage;
const legacy = {
  workspaces: [{ id: 'a', name: 'Alpha', folderId: 'f', custom: { keep: true } }],
  folders: [{ id: 'f', name: 'Folder' }],
  activeId: 'a',
  futureKey: [1, 'two'],
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pulse-local-manifest-'));
  storage = await activateLocalCanvasStorage({ root, loadLegacyWorkspaces: async () => [] }) as SqliteStorage;
});

afterEach(async () => {
  await storage.close();
  await rm(root, { recursive: true, force: true });
});

const legacyPath = () => join(root, '__workspaces__.json');
function options(loadLegacyManifest: () => Promise<JsonObject>): LocalWorkspaceManifestOptions {
  return { root, storage, loadLegacyManifest };
}
const bundle = (workspaceId: string) => ({ canvas: { workspaceId, metadata: {}, nodes: [], placements: [], edges: [] } });
const entryIds = (manifest: JsonObject) => (manifest.workspaces as JsonObject[]).map(entry => entry.id);

describe('local workspace manifest', () => {
  it('imports the legacy file once, then never reads it again', async () => {
    const loader = vi.fn(async () => structuredClone(legacy) as JsonObject);
    const first = await readLocalWorkspaceManifest(options(loader));
    expect(first).toMatchObject({ revision: 1, manifest: legacy });
    // A later file edit (an older build, or a stale backup) is not current state.
    await writeFile(legacyPath(), JSON.stringify({ workspaces: [{ id: 'stale', name: 'Old name' }] }));
    expect((await readLocalWorkspaceManifest(options(loader))).manifest).toEqual(legacy);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('imports an empty manifest when there is no file and keeps it authoritative', async () => {
    const loader = vi.fn(async () => ({}));
    expect((await readLocalWorkspaceManifest(options(loader))).manifest).toEqual({});
    await writeFile(legacyPath(), JSON.stringify(legacy));
    expect((await readLocalWorkspaceManifest(options(loader))).manifest).toEqual({});
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('commits updates from the current revision and does not write the legacy file', async () => {
    const loader = vi.fn(async () => structuredClone(legacy) as JsonObject);
    await writeFile(legacyPath(), JSON.stringify(legacy));
    const next = await updateLocalWorkspaceManifest(options(loader), current => ({
      ...current,
      workspaces: [...(current.workspaces as JsonObject[]), { id: 'b', name: 'Beta' }],
    }));
    expect(next.manifest.futureKey).toEqual([1, 'two']);
    expect(entryIds(next.manifest)).toEqual(['a', 'b']);
    expect(JSON.parse(await readFile(legacyPath(), 'utf8'))).toEqual(legacy);
    expect(await readLocalWorkspaceManifest(options(loader))).toEqual(next);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('publishes a bundle and its manifest entry through a bundle committer', async () => {
    const loader = vi.fn(async () => structuredClone(legacy) as JsonObject);
    const next = await updateLocalWorkspaceManifest(
      options(loader),
      current => ({ ...current, workspaces: [...(current.workspaces as JsonObject[]), { id: 'b', name: 'Beta' }] }),
      manifest => storage.workspaces.importBundle({ ...bundle('b'), manifest }),
    );
    expect(entryIds(next.manifest)).toEqual(['a', 'b']);
    expect(await storage.workspaces.readBundle('b')).not.toBeNull();
  });

  it('commits neither the bundle nor the manifest when the update is stale', async () => {
    const loader = vi.fn(async () => structuredClone(legacy) as JsonObject);
    const before = await readLocalWorkspaceManifest(options(loader));
    await expect(updateLocalWorkspaceManifest(
      options(loader),
      current => ({ ...current, workspaces: [] }),
      async manifest => {
        // Another commit lands between the read and this bundle transaction.
        await storage.workspaceManifest.commit({ expectedRevision: manifest.expectedRevision, manifest: { workspaces: [] } });
        return storage.workspaces.importBundle({ ...bundle('b'), manifest });
      },
    )).rejects.toMatchObject({ code: 'revision_conflict' });
    expect(await storage.workspaces.readBundle('b')).toBeNull();
    expect((await storage.workspaceManifest.read())?.revision).toBeGreaterThan(before.revision);
  });

  it('serializes concurrent first reads to one import', async () => {
    const loader = vi.fn(async () => structuredClone(legacy) as JsonObject);
    const results = await Promise.all([1, 2, 3].map(() => readLocalWorkspaceManifest(options(loader))));
    expect(new Set(results.map(result => result.revision))).toEqual(new Set([1]));
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('runs the import inside an existing storage-lock owner', async () => {
    const loader = vi.fn(async () => structuredClone(legacy) as JsonObject);
    const result = await withLegacyCanvasWrite(root, () => readLocalWorkspaceManifest(options(loader)), { allowActive: true });
    expect(result.revision).toBe(1);
  });

  it('rejects a store whose Canvas domain is not active', async () => {
    const other = await mkdtemp(join(tmpdir(), 'pulse-local-manifest-legacy-'));
    const legacyStore = await openSqliteStorage({ path: join(other, '__storage__.sqlite') });
    try {
      const loader = vi.fn(async () => ({}));
      await expect(readLocalWorkspaceManifest({ root: other, storage: legacyStore, loadLegacyManifest: loader }))
        .rejects.toMatchObject({ code: 'storage_unavailable' });
      expect(loader).not.toHaveBeenCalled();
    } finally {
      await legacyStore.close();
      await rm(other, { recursive: true, force: true });
    }
  });
});
