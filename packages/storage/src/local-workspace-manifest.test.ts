import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

const mirrorPath = () => join(root, '__workspaces__.json');
function options(loadLegacyManifest: () => Promise<JsonObject>, extra: Partial<LocalWorkspaceManifestOptions> = {}): LocalWorkspaceManifestOptions {
  return { root, storage, loadLegacyManifest, mirrorPath: mirrorPath(), ...extra };
}

describe('local workspace manifest', () => {
  it('imports the legacy file once, then never reads it again', async () => {
    const loader = vi.fn(async () => structuredClone(legacy) as JsonObject);
    const first = await readLocalWorkspaceManifest(options(loader));
    expect(first).toMatchObject({ revision: 1, manifest: legacy });
    // A later file edit (an older build, or a stale backup) is not current state.
    await writeFile(mirrorPath(), JSON.stringify({ workspaces: [{ id: 'stale', name: 'Old name' }] }));
    expect((await readLocalWorkspaceManifest(options(loader))).manifest).toEqual(legacy);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('imports an empty manifest when there is no file and keeps it authoritative', async () => {
    const loader = vi.fn(async () => ({}));
    expect((await readLocalWorkspaceManifest(options(loader))).manifest).toEqual({});
    await writeFile(mirrorPath(), JSON.stringify(legacy));
    expect((await readLocalWorkspaceManifest(options(loader))).manifest).toEqual({});
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('commits updates from the current revision and mirrors them to the JSON file', async () => {
    const loader = vi.fn(async () => structuredClone(legacy) as JsonObject);
    const next = await updateLocalWorkspaceManifest(options(loader), current => ({
      ...current,
      workspaces: [...(current.workspaces as JsonObject[]), { id: 'b', name: 'Beta' }],
    }));
    expect(next.revision).toBe(2);
    expect(next.manifest.futureKey).toEqual([1, 'two']);
    expect(JSON.parse(await readFile(mirrorPath(), 'utf8'))).toEqual(next.manifest);
    expect((await readLocalWorkspaceManifest(options(loader))).manifest).toEqual(next.manifest);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('keeps the database commit when the mirror write fails', async () => {
    const onMirrorError = vi.fn();
    await mkdir(join(root, 'blocked'));
    // A directory at the mirror path makes the rename fail.
    await mkdir(join(root, 'blocked', '__workspaces__.json'));
    const broken = options(async () => ({}), { mirrorPath: join(root, 'blocked', '__workspaces__.json'), onMirrorError });
    const result = await updateLocalWorkspaceManifest(broken, () => ({ workspaces: [{ id: 'x', name: 'X' }] }));
    expect(onMirrorError).toHaveBeenCalled();
    expect((await storage.workspaceManifest.read())?.manifest).toEqual(result.manifest);
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
      await expect(readLocalWorkspaceManifest({ root: other, storage: legacyStore, loadLegacyManifest: loader, mirrorPath: join(other, 'm.json') }))
        .rejects.toMatchObject({ code: 'storage_unavailable' });
      expect(loader).not.toHaveBeenCalled();
    } finally {
      await legacyStore.close();
      await rm(other, { recursive: true, force: true });
    }
  });
});
