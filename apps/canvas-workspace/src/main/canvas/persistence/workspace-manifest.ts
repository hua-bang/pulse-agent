import { StorageError, type JsonObject } from '@pulse-coder/storage';
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
 * is imported once and then only mirrored for readers not yet on storage.
 * Legacy stores keep the file.
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

/** The one-time import leaves out trashed workspaces; every other field is kept as written. */
function withoutTrashed(manifest: Record<string, unknown>, trashed: Set<string>): Record<string, unknown> {
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
    mirrorPath: getCanvasJsonPath(MANIFEST_ID, root),
    onMirrorError: error => console.warn('[canvas-storage] workspace manifest mirror write failed; the next save retries it', error),
  };
}

/** The unfiltered manifest document from its current authority. Missing reads as `{}`. */
export async function readWorkspaceManifestDocument(root: string): Promise<Record<string, unknown>> {
  const storage = await getManifestStorage(root);
  if (!storage) return readManifestFile(root);
  return (await readLocalWorkspaceManifest(storageOptions(root, storage))).manifest;
}

/**
 * Replace the manifest under the storage lock. Active stores commit to the
 * database from the current revision and refresh the mirror; legacy stores
 * write the file with its rolling backup.
 */
export async function updateWorkspaceManifestDocument(
  root: string,
  update: (current: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  return withLegacyCanvasWrite(root, async () => {
    const storage = await getManifestStorage(root);
    if (storage) {
      const snapshot = await updateLocalWorkspaceManifest(
        storageOptions(root, storage),
        async current => toJsonObject(await update(current)),
      );
      return snapshot.manifest;
    }
    const next = await update(await readManifestFile(root));
    await atomicWriteJson(getCanvasJsonPath(MANIFEST_ID, root), JSON.stringify(next, null, 2), { rollingBackup: true });
    return next;
  }, { allowActive: true, resolveNativeBinding: resolveStorageNativeBinding });
}
