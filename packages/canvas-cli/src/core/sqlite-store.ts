import { resolve } from 'path';
import type { PulseStorage } from '@pulse-coder/storage';
import { StorageError } from '@pulse-coder/storage';
import { createCanvasCompatibilityStore } from '@pulse-coder/storage/canvas';
import { openLocalStorage } from '@pulse-coder/storage/local';
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

/** No migration or native loading for legacy roots; active roots never fall back. */
export async function withSqliteCanvas<T>(
  storeDir: string | undefined,
  operation: (storage: PulseStorage, canvas: CompatibilityStore) => Promise<T>,
): Promise<SqliteStoreResult<T>> {
  const root = localStoreRoot(storeDir);
  const storage = await openLocalStorage({
    root,
    resolveNativeBinding: resolveSqliteNativeBinding,
  });
  if (!storage) return { active: false };
  try {
    const states = await storage.localActivation.read();
    if (!states.some(state => state.domain === 'canvas' && state.state === 'active')) return { active: false };
    return { active: true, value: await operation(storage, createCanvasCompatibilityStore(storage.canvas)) };
  } finally {
    await storage.close();
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
