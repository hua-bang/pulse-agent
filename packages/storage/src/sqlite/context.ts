import type Database from 'better-sqlite3';
import type { StorageChange } from '../contracts.js';
import { StorageError, isStorageError } from '../errors.js';

export interface SqliteContext {
  generation: string;
  db: Database.Database;
  guard<T>(operation: () => T): T;
  nextRevision(domain: StorageChange['domain'], scopeId: string, resourceId: string): number;
  change(
    domain: StorageChange['domain'],
    scopeId: string,
    resourceId: string,
    revision: number,
    kind: StorageChange['kind'],
    ids: string[],
  ): string;
}

export function storageError(error: unknown): StorageError {
  if (isStorageError(error)) return error;
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const cause = { cause: error };
  if (code.startsWith('SQLITE_BUSY') || code.startsWith('SQLITE_LOCKED')) {
    return new StorageError('storage_busy', 'Storage is busy; retry the operation from a fresh revision', cause);
  }
  if (code.startsWith('SQLITE_CONSTRAINT')) {
    return new StorageError('invalid_argument', 'Storage constraint rejected the mutation', cause);
  }
  if (code.startsWith('SQLITE_CORRUPT') || code.startsWith('SQLITE_NOTADB')) {
    return new StorageError('corrupt_data', 'Storage is corrupt or is not a valid database', cause);
  }
  return new StorageError('storage_unavailable', 'Persistent storage operation failed', cause);
}
