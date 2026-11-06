import { StorageError, type JsonObject, type WorkspaceManifestCommit } from '@pulse-coder/storage';
import {
  readLocalWorkspaceManifest,
  updateLocalWorkspaceManifest,
  withLegacyCanvasWrite,
  type LocalWorkspaceManifestOptions,
} from '@pulse-coder/storage/local';
import type { SqliteStorage } from '@pulse-coder/storage/sqlite';
import { atomicWriteJson, readJsonWithRecovery } from './atomic-json';
import { getLocalCanvasStorage, resolveStorageNativeBinding } from './backend';
import { getCanvasJsonPath, MANIFEST_ID } from './paths';

/**
 * The workspace manifest (`__workspaces__.json`): names, folders, order, and
 * the active id. After Canvas activation the database owns it; the legacy file
 * is imported once and then neither read nor written again. Legacy stores keep
 * the file.
 */

const object = (value: unknown): value is Record<string, unknown> => (
  !!value && typeof value === 'object' && !Array.isArray(value)
);

/** The legacy file, with its rolling `.bak` fallback. Missing reads as `{}`. */
async function readManifestFile(root: string): Promise<Record<string, unknown>> {
  const result = await readJsonWithRecovery(getCanvasJsonPath(MANIFEST_ID, root));
  if (result.kind === 'unrecoverable') throw result.err;
  if (result.kind === 'missing') return {};
  if (!object(result.data)) throw new StorageError('corrupt_data', 'Invalid workspace manifest');
  return result.data;
}

/** The store when its Canvas domain is active (the manifest lives there), otherwise null. */
export async function getManifestStorage(root: string): Promise<SqliteStorage | null> {
  const storage = await getLocalCanvasStorage(root);
  if (!storage) return null;
  const states = await storage.localActivation.read();
  return states.some(row => row.domain === 'canvas' && row.state === 'active') ? storage : null;
}

async function trashedIds(storage: SqliteStorage): Promise<Set<string>> {
  const ids = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await storage.workspaces.listTrashed({ cursor, limit: 500 });
    for (const item of page.items) ids.add(item.workspaceId);
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return ids;
}

/**
 * Drop the entries of `trashed` ids and move a trashed `activeId` to the first
 * remaining entry. Every other field is kept as written.
 */
export function withoutTrashed(manifest: Record<string, unknown>, trashed: ReadonlySet<string>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...manifest };
  for (const key of ['workspaces', 'entries']) {
    const list = manifest[key];
    if (Array.isArray(list)) result[key] = list.filter(item => !(object(item) && typeof item.id === 'string' && trashed.has(item.id)));
  }
  if (typeof result.activeId === 'string' && trashed.has(result.activeId)) {
    const preferred = (Array.isArray(result.workspaces) ? result.workspaces : result.entries) as unknown[] | undefined;
    const first = preferred?.find(object);
    result.activeId = typeof first?.id === 'string' ? first.id : '';
  }
  return result;
}

function toJsonObject(value: Record<string, unknown>): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function storageOptions(root: string, storage: SqliteStorage): LocalWorkspaceManifestOptions {
  return {
    root,
    storage,
    resolveNativeBinding: resolveStorageNativeBinding,
    loadLegacyManifest: async () => toJsonObject(withoutTrashed(await readManifestFile(root), await trashedIds(storage))),
  };
}

/** The unfiltered manifest document from its current authority. Missing reads as `{}`. */
export async function readWorkspaceManifestDocument(root: string): Promise<Record<string, unknown>> {
  const storage = await getManifestStorage(root);
  if (!storage) return readManifestFile(root);
  return (await readLocalWorkspaceManifest(storageOptions(root, storage))).manifest;
}

/**
 * A workspace bundle transaction that also commits the prepared manifest, so
 * the bundle change and its entry change are one commit. Requires SQLite.
 */
export type WorkspaceManifestBundleCommit = (storage: SqliteStorage, manifest: WorkspaceManifestCommit) => Promise<unknown>;

/**
 * Replace the manifest under the storage lock. Active stores commit to the
 * database from the current revision, through `bundle` when it is given;
 * legacy stores write the file with its rolling backup.
 */
export async function updateWorkspaceManifestDocument(
  root: string,
  update: (current: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>,
  bundle?: WorkspaceManifestBundleCommit,
): Promise<Record<string, unknown>> {
  return withLegacyCanvasWrite(root, async () => {
    const storage = await getManifestStorage(root);
    if (storage) {
      const snapshot = await updateLocalWorkspaceManifest(
        storageOptions(root, storage),
        async current => toJsonObject(await update(current)),
        bundle && (input => bundle(storage, input)),
      );
      return snapshot.manifest;
    }
    if (bundle) throw new StorageError('storage_unavailable', 'This workspace change requires SQLite storage');
    const next = await update(await readManifestFile(root));
    await atomicWriteJson(getCanvasJsonPath(MANIFEST_ID, root), JSON.stringify(next, null, 2), { rollingBackup: true });
    return next;
  }, { allowActive: true, resolveNativeBinding: resolveStorageNativeBinding });
}
