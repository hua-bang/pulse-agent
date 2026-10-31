import { isStorageError, StorageError, type JsonObject } from '@pulse-coder/storage';
import { withLegacyCanvasWrite } from '@pulse-coder/storage/local';
import { getCanvasBackend, getLocalCanvasStorage, resolveStorageNativeBinding } from './backend';
import { getCanvasJsonPath, isSafeNodeId, MANIFEST_ID } from './paths';
import { atomicWriteJson, readJsonWithRecovery } from './atomic-json';
import { getCanvasSessionArchivePort } from './session-archive-port';
import { filterWorkspaceManifest } from '../workspaces';

type CanvasBackend = NonNullable<Awaited<ReturnType<typeof getCanvasBackend>>>;

const object = (value: unknown): value is Record<string, unknown> => (
  !!value && typeof value === 'object' && !Array.isArray(value)
);

async function readRawManifest(root: string): Promise<Record<string, unknown>> {
  const result = await readJsonWithRecovery(getCanvasJsonPath(MANIFEST_ID, root));
  if (result.kind === 'unrecoverable') throw result.err;
  if (result.kind === 'missing') return {};
  if (!object(result.data)) throw new StorageError('corrupt_data', 'Invalid workspace manifest');
  return result.data;
}

/** The retained entry is display metadata, never a second deletion authority. */
export async function trashWorkspace(root: string, workspaceId: string): Promise<void> {
  if (!isSafeNodeId(workspaceId) || workspaceId === MANIFEST_ID) {
    throw new StorageError('invalid_argument', 'Invalid workspace id');
  }
  const port = await getCanvasSessionArchivePort();
  await port.assertWorkspaceStorage(root);
  await port.withWorkspaceTrashGuard(workspaceId, () => withLegacyCanvasWrite(root, async () => {
    if (!await getCanvasBackend(root)) {
      throw new StorageError('storage_unavailable', 'Upgrade this profile to SQLite before deleting a workspace. No files were removed.');
    }
    const storage = await getLocalCanvasStorage(root);
    if (!storage) throw new StorageError('storage_unavailable', 'Workspace storage is unavailable');
    if (await storage.workspaces.getTrashed(workspaceId)) return;
    const bundle = await storage.workspaces.readBundle(workspaceId);
    if (!bundle) throw new StorageError('not_found', 'Workspace was not found');
    const manifest = await readRawManifest(root);
    const entries = Array.isArray(manifest.workspaces) ? manifest.workspaces : manifest.entries;
    const entry = Array.isArray(entries) ? entries.find(item => object(item) && item.id === workspaceId) : undefined;
    await storage.workspaces.trashBundle({
      workspaceId,
      expectedCanvasRevision: bundle.canvas.revision,
      generation: bundle.canvas.generation,
      expectedConversations: bundle.conversationState,
      metadata: (object(entry) ? entry : { id: workspaceId, name: workspaceId }) as JsonObject,
    });
  }, { allowActive: true, resolveNativeBinding: resolveStorageNativeBinding }));
}

/**
 * Undo for an app-side delete. Like the CLI restore, it publishes the saved
 * manifest entry first (reads hide it until SQL commits), then restores SQL
 * visibility, so a failed manifest write leaves the workspace in trash.
 */
export async function restoreTrashedWorkspace(root: string, workspaceId: string): Promise<JsonObject> {
  if (!isSafeNodeId(workspaceId) || workspaceId === MANIFEST_ID) {
    throw new StorageError('invalid_argument', 'Invalid workspace id');
  }
  return withLegacyCanvasWrite(root, async () => {
    const storage = await getLocalCanvasStorage(root);
    if (!storage) throw new StorageError('storage_unavailable', 'Workspace storage is unavailable');
    const record = await storage.workspaces.getTrashed(workspaceId);
    if (!record) throw new StorageError('not_found', `Deleted workspace not found: ${workspaceId}`);
    const entry: JsonObject = {
      ...record.metadata,
      id: workspaceId,
      name: typeof record.metadata.name === 'string' ? record.metadata.name : workspaceId,
    };
    const manifest = await readRawManifest(root);
    const others = (Array.isArray(manifest.workspaces) ? manifest.workspaces : [])
      .filter(item => !(object(item) && item.id === workspaceId));
    const next = { ...manifest, workspaces: [...others, entry] };
    await atomicWriteJson(getCanvasJsonPath(MANIFEST_ID, root), JSON.stringify(next, null, 2), { rollingBackup: true });
    await storage.workspaces.restoreBundle(workspaceId, record.revision, record.generation);
    return entry;
  }, { allowActive: true, resolveNativeBinding: resolveStorageNativeBinding });
}

/**
 * A listed workspace must have a Canvas record, or the CLI and deletion treat it
 * as missing. The renderer creates entries before their first canvas save, so
 * register empty canvases here. Trashed ids were already filtered out.
 */
async function ensureListedCanvases(backend: CanvasBackend, workspaces: unknown): Promise<void> {
  if (!Array.isArray(workspaces)) return;
  for (const item of workspaces) {
    const id = object(item) ? item.id : undefined;
    if (typeof id !== 'string' || id === MANIFEST_ID || !isSafeNodeId(id)) continue;
    if (await backend.readCanvas(id)) continue;
    try {
      await backend.writeCanvas(id, { nodes: [], edges: [], transform: { x: 0, y: 0, scale: 1 } }, { allowEmpty: true });
    } catch (error) {
      // A concurrent first save created it; that record wins.
      if (!(isStorageError(error) && error.code === 'revision_conflict')) throw error;
    }
  }
}

/** Preserve restored/externally-created entries against an older renderer list. */
export async function saveWorkspaceManifest(root: string, input: unknown): Promise<void> {
  if (!object(input)) throw new StorageError('invalid_argument', 'Workspace manifest must be an object');
  await withLegacyCanvasWrite(root, async () => {
    const previous = await readRawManifest(root);
    let next = { ...previous, ...input };
    const backend = await getCanvasBackend(root);
    if (backend && Array.isArray(input.workspaces)) {
      const incoming = new Set(input.workspaces.filter(object).map(item => item.id));
      const oldEntries = Array.isArray(previous.workspaces) ? previous.workspaces : [];
      next = { ...next, workspaces: [...input.workspaces, ...oldEntries.filter(item => object(item) && !incoming.has(item.id))] };
      next = await filterWorkspaceManifest(root, next);
    }
    await atomicWriteJson(getCanvasJsonPath(MANIFEST_ID, root), JSON.stringify(next, null, 2), { rollingBackup: true });
    // After the manifest: a failure here leaves the entry listed, and the next save retries.
    if (backend && Array.isArray(input.workspaces)) await ensureListedCanvases(backend, next.workspaces);
  }, { allowActive: true, resolveNativeBinding: resolveStorageNativeBinding });
}
