import { isStorageError } from '@pulse-coder/storage';
import type { LegacyCanvas } from '@pulse-coder/storage/canvas';
import { BrowserWindow } from 'electron';
import { getCanvasBackend, getLocalCanvasStorage } from './persistence/backend';
import { MANIFEST_ID, STORE_DIR } from './persistence/paths';
import { observeSqliteChanges, type SqliteChangeObserver } from './sync/sqlite-watcher';
import { watchWorkspaceMarkdown, stopMarkdownIndexWatchers, stopWorkspaceMarkdown } from './sync/markdown-index';

let observerPromise: Promise<SqliteChangeObserver> | null = null;

async function ensureObserver() {
  const store = await getLocalCanvasStorage(STORE_DIR);
  if (!store) return null;
  if (!observerPromise) {
    observerPromise = observeSqliteChanges(store, change => {
      if (change.kind === 'removed') stopWorkspaceMarkdown(STORE_DIR, change.scopeId);
      const payload = {
        workspaceId: change.scopeId,
        nodeIds: change.changedIds,
        edgeIds: change.changedIds,
        kind: change.kind === 'removed' ? 'delete' : 'update',
        source: 'sqlite',
        revision: change.revision,
      };
      for (const window of BrowserWindow.getAllWindows()) {
        if (window.isDestroyed()) continue;
        try { window.webContents.send('canvas:external-update', payload); }
        catch (error) {
          // A closing/crashed renderer must not stall delivery to other windows
          // or keep the shared commit cursor stuck on this event.
          console.warn('[canvas-storage] Could not notify a window', error);
        }
      }
    }).catch(error => {
      observerPromise = null;
      throw error;
    });
  }
  return observerPromise;
}

export async function loadSqliteCanvas(id: string, prepare?: () => Promise<void>) {
  const backend = await getCanvasBackend(STORE_DIR);
  if (!backend) return null;
  await ensureObserver();
  if (id === MANIFEST_ID) return null;
  const storage = await getLocalCanvasStorage(STORE_DIR);
  if (await storage?.workspaces.getTrashed(id)) return { ok: false, code: 'not_found', error: 'This workspace is deleted; restore it before opening it.' };
  await prepare?.();
  if (storage) await watchWorkspaceMarkdown(STORE_DIR, storage, id);
  return { ok: true, data: await backend.readCanvas(id) };
}

export async function listSqliteCanvases() {
  if (!await getCanvasBackend(STORE_DIR)) return null;
  const store = await getLocalCanvasStorage(STORE_DIR);
  if (!store) return null;
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await store.canvas.list({ cursor, limit: 500 });
    ids.push(...page.items.map(item => item.workspaceId).filter(id => !id.startsWith('__')));
    cursor = page.nextCursor;
  } while (cursor);
  return { ok: true, ids };
}

export async function saveSqliteCanvas(id: string, input: unknown) {
  if (id === MANIFEST_ID) return null;
  const backend = await getCanvasBackend(STORE_DIR);
  if (!backend) return null;
  await ensureObserver();
  if (!input || typeof input !== 'object' || !Array.isArray((input as LegacyCanvas).nodes)) {
    return { ok: false, code: 'invalid_argument', error: 'Canvas nodes must be an array' };
  }
  try {
    const receipt = await backend.writeCanvas(id, input as LegacyCanvas, { allowEmpty: true });
    // Every window receives the committed revision, including sibling windows
    // in this process. The writer ignores already acknowledged revisions.
    return { ok: true, ...receipt };
  } catch (error) {
    const code = isStorageError(error) ? error.code : 'storage_unavailable';
    return {
      ok: false,
      code,
      error: String(error),
      ...(code === 'revision_conflict' ? { data: await backend.readCanvas(id) } : {}),
    };
  }
}

export function stopSqliteCanvasObserver(): void {
  stopMarkdownIndexWatchers();
  const pending = observerPromise;
  observerPromise = null;
  if (pending) void pending.then(observer => observer.stop()).catch(() => undefined);
}
