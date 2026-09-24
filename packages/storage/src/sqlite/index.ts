import Database from 'better-sqlite3';
import { mkdir, open, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { PulseStorage } from '../contracts.js';
import { StorageError } from '../errors.js';
import { createCanvasRepository } from './canvas.js';
import { createConversationRepository } from './conversations.js';
import { createConversationScopeRepository } from './conversation-scopes.js';
import { createFileWriteRepository } from './file-writes.js';
import { createWorkspaceRepository } from './workspaces.js';
import { createLocalActivationRepository, type LocalActivationRepository } from './local-activation.js';
import { createChangeRepository } from './changes.js';
import { storageError, type SqliteContext } from './context.js';
import { initializeSchema } from './schema.js';
import { encodeCursor, encodeJson } from './validation.js';

export interface SqliteStorageOptions {
  path: string;
  /** Host packaging may supply a runtime-specific Node/Electron native binary. */
  nativeBinding?: string;
  busyTimeoutMs?: number;
  /** Open an already initialized Pulse database; never create a replacement. */
  fileMustExist?: boolean;
  /** Newest change-log entries kept for cursor readers; older entries are pruned. */
  changeRetention?: number;
}

const DEFAULT_CHANGE_RETENTION = 10_000;

function supportsSafeWal(version: string): boolean {
  const [major, minor, patch] = version.split('.').map(Number);
  return major > 3 || (major === 3 && (
    minor > 51 || (minor === 51 && patch >= 3)
    || (minor === 50 && patch >= 7) || (minor === 44 && patch >= 6)
  ));
}

export interface SqliteStorage extends PulseStorage {
  /** Adapter-owned migration authority; never inferred from an absent filesystem marker. */
  localActivation: LocalActivationRepository;
}

/**
 * True only for a file SQLite created but no Pulse schema transaction ever
 * committed to (a crash between creating the file and initializing it).
 * Foreign or damaged databases are never reported as uninitialized.
 */
export async function isUninitializedSqliteFile(path: string, nativeBinding?: string): Promise<boolean> {
  if (typeof path !== 'string' || !isAbsolute(path)) {
    throw new StorageError('invalid_argument', 'SQLite inspection requires an absolute path');
  }
  let db: Database.Database | undefined;
  try {
    db = new Database(path, { nativeBinding, fileMustExist: true });
    const version = db.pragma('user_version', { simple: true }) as number;
    const objects = (db.prepare('SELECT COUNT(*) AS count FROM sqlite_master').get() as { count: number }).count;
    return version === 0 && objects === 0;
  } catch (error) {
    throw storageError(error);
  } finally {
    db?.close();
  }
}

export async function openSqliteStorage(options: SqliteStorageOptions): Promise<SqliteStorage> {
  if (!options || typeof options.path !== 'string'
    || (options.path !== ':memory:' && !isAbsolute(options.path))) {
    throw new StorageError('invalid_argument', 'SQLite storage requires an absolute path');
  }
  const timeout = options.busyTimeoutMs ?? 5000;
  if (!Number.isSafeInteger(timeout) || timeout < 0 || timeout > 60000) {
    throw new StorageError('invalid_argument', 'Invalid storage lock timeout');
  }
  const retention = options.changeRetention ?? DEFAULT_CHANGE_RETENTION;
  if (!Number.isSafeInteger(retention) || retention < 1) {
    throw new StorageError('invalid_argument', 'Invalid change-log retention');
  }
  // Pruning in the inserting transaction keeps the log bounded at retention + interval rows.
  const pruneInterval = Math.min(1000, retention);
  let db: Database.Database | undefined;
  let generation: string;
  try {
    if (options.path !== ':memory:') await mkdir(dirname(options.path), { recursive: true });
    db = new Database(options.path, {
      timeout,
      nativeBinding: options.nativeBinding,
      fileMustExist: options.fileMustExist ?? false,
    });
    if (options.fileMustExist && db.pragma('user_version', { simple: true }) === 0) {
      throw new StorageError('corrupt_data', 'Expected an initialized Pulse database');
    }
    const version = (db.prepare('SELECT sqlite_version() AS version').get() as { version: string }).version;
    if (!supportsSafeWal(version)) {
      throw new StorageError('storage_unavailable', `SQLite ${version} lacks the WAL-reset fix`);
    }
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = FULL');
    const mode = db.pragma('journal_mode = WAL', { simple: true });
    if (mode !== 'wal' && options.path !== ':memory:') {
      throw new StorageError('storage_unavailable', 'SQLite could not enable WAL mode');
    }
    initializeSchema(db);
    const identity = db.prepare('SELECT generation FROM storage_identity WHERE singleton = 1').get() as { generation?: unknown } | undefined;
    if (typeof identity?.generation !== 'string' || !identity.generation) {
      throw new StorageError('corrupt_data', 'Storage identity is missing');
    }
    generation = identity.generation;
  } catch (error) {
    db?.close();
    throw storageError(error);
  }

  const connection = db;
  let closed = false;
  // Every commit allocates a revision and appends a change; compile these once.
  const allocateRevision = connection.prepare(`
    INSERT INTO resource_versions (domain, scope_id, resource_id, revision)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(domain, scope_id, resource_id) DO UPDATE SET revision = revision + 1
    RETURNING revision
  `);
  const insertChange = connection.prepare(`
    INSERT INTO storage_changes (domain, scope_id, resource_id, revision, kind, changed_ids)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const pruneChanges = connection.prepare('DELETE FROM storage_changes WHERE sequence <= ?');
  const ctx: SqliteContext = {
    generation,
    db: connection,
    guard(operation) {
      if (closed) throw new StorageError('storage_closed', 'Storage is closed');
      try { return operation(); }
      catch (error) { throw storageError(error); }
    },
    nextRevision(domain, scopeId, resourceId) {
      if (!connection.inTransaction) {
        throw new StorageError('storage_unavailable', 'Revision allocation requires a transaction');
      }
      const row = allocateRevision.get(domain, scopeId, resourceId) as { revision: number };
      return row.revision;
    },
    change(domain, scopeId, resourceId, revision, kind, ids) {
      const result = insertChange.run(domain, scopeId, resourceId, revision, kind, encodeJson([...new Set(ids)]));
      const sequence = Number(result.lastInsertRowid);
      if (sequence % pruneInterval === 0) {
        // AUTOINCREMENT never reuses pruned sequences, so retained cursors stay valid.
        pruneChanges.run(sequence - retention);
      }
      return encodeCursor(String(sequence));
    },
  };

  return {
    generation,
    localActivation: createLocalActivationRepository(ctx),
    canvas: createCanvasRepository(ctx),
    workspaces: createWorkspaceRepository(ctx),
    conversations: createConversationRepository(ctx),
    conversationScopes: createConversationScopeRepository(ctx),
    fileWrites: createFileWriteRepository(ctx),
    changes: createChangeRepository(ctx),
    async backup(destination) {
      ctx.guard(() => {
        if (!isAbsolute(destination) || resolve(destination) === resolve(options.path)) {
          throw new StorageError('invalid_argument', 'Backup requires a different absolute destination');
        }
      });
      let ownsDestination = false;
      try {
        await mkdir(dirname(destination), { recursive: true });
        const reservation = await open(destination, 'wx', 0o600);
        ownsDestination = true;
        await reservation.close();
        await connection.backup(destination);
      }
      catch (error) {
        if (ownsDestination) await unlink(destination).catch(() => undefined);
        if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
          throw new StorageError('invalid_argument', 'Backup destination already exists');
        }
        throw storageError(error);
      }
    },
    async checkIntegrity() {
      return ctx.guard(() => {
        const checks = connection.pragma('integrity_check') as Array<{ integrity_check: string }>;
        const foreignKeys = connection.pragma('foreign_key_check') as unknown[];
        const issues = checks.map(row => row.integrity_check).filter(value => value !== 'ok');
        if (foreignKeys.length) issues.push(`${foreignKeys.length} foreign key violation(s)`);
        return { ok: issues.length === 0, issues };
      });
    },
    async close() {
      if (closed) return;
      ctx.guard(() => connection.close());
      closed = true;
    },
  };
}
