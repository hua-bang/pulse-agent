import { AsyncLocalStorage } from 'node:async_hooks';
import { resolve } from 'path';
import type { PulseStorage } from '@pulse-coder/storage';
import { StorageError } from '@pulse-coder/storage';
import { createCanvasCompatibilityStore } from '@pulse-coder/storage/canvas';
import { openLocalStorage } from '@pulse-coder/storage/local';
import type { SqliteStorage } from '@pulse-coder/storage/sqlite';
import { DEFAULT_STORE_DIR } from './constants';
import { resolveSqliteNativeBinding } from './native-binding';

type CompatibilityStore = ReturnType<typeof createCanvasCompatibilityStore>;
export type SqliteStoreResult<T> = { active: false } | { active: true; value: T };

export function localStoreRoot(storeDir?: string): string {
  return resolve(storeDir ?? DEFAULT_STORE_DIR);
}

export async function hasSqliteStorage(storeDir?: string): Promise<boolean> {
  return (await withSqliteCanvas(storeDir, async () => undefined)).active;
}

const sessions = new AsyncLocalStorage<Map<string, Promise<SqliteStorage | null>>>();

/**
 * Share one database connection per data root for the duration of one CLI
 * command, closing every connection when it finishes. Outside a session each
 * access opens and closes its own connection.
 */
export async function withStorageSession<T>(operation: () => Promise<T>): Promise<T> {
  const connections = new Map<string, Promise<SqliteStorage | null>>();
  try {
    return await sessions.run(connections, operation);
  } finally {
    const opened = await Promise.allSettled(connections.values());
    await Promise.all(opened.map(result => (result.status === 'fulfilled' ? result.value?.close() : undefined)));
  }
}

async function openCanvasStorage(root: string): Promise<{ storage: SqliteStorage | null; shared: boolean }> {
  const connections = sessions.getStore();
  const open = () => openLocalStorage({ root, resolveNativeBinding: resolveSqliteNativeBinding });
  if (!connections) return { storage: await open(), shared: false };
  let pending = connections.get(root);
  if (!pending) {
    // Cache the attempt itself so concurrent calls share one connection.
    const attempt = open();
    pending = attempt;
    connections.set(root, attempt);
    // Only an opened store is shared: an inactive root may be activated by the app mid-command.
    const forget = () => { if (connections.get(root) === attempt) connections.delete(root); };
    attempt.then(storage => { if (!storage) forget(); }, forget);
  }
  return { storage: await pending, shared: true };
}

/** No migration or native loading for legacy roots; active roots never fall back. */
export async function withSqliteCanvas<T>(
  storeDir: string | undefined,
  operation: (storage: PulseStorage, canvas: CompatibilityStore) => Promise<T>,
): Promise<SqliteStoreResult<T>> {
  const { storage, shared } = await openCanvasStorage(localStoreRoot(storeDir));
  if (!storage) return { active: false };
  try {
    const states = await storage.localActivation.read();
    if (!states.some(state => state.domain === 'canvas' && state.state === 'active')) return { active: false };
    return { active: true, value: await operation(storage, createCanvasCompatibilityStore(storage.canvas)) };
  } finally {
    if (!shared) await storage.close();
  }
}

export async function listSqliteWorkspaceIds(storeDir?: string): Promise<SqliteStoreResult<string[]>> {
  return withSqliteCanvas(storeDir, async storage => {
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await storage.canvas.list({ cursor, limit: 500 });
      ids.push(...page.items.map(item => item.workspaceId));
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    return ids;
  });
}

export async function requireLegacyCanvasStorage(storeDir?: string): Promise<void> {
  if (await hasSqliteStorage(storeDir)) {
    throw new StorageError('unsupported_schema',
      'This command restores legacy JSON only. SQLite is active; use a SQLite backup or the application recovery flow.');
  }
}

export function storageErrorCode(error: unknown, fallback = 'error'): string {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code : fallback;
}
