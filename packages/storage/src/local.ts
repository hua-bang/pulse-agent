import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { lstat, mkdir, open, readFile, rename, rmdir, stat, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { EntityRecord, JsonObject, PulseStorage, RecordChanges } from './contracts.js';
import { StorageError, isStorageError } from './errors.js';
import { openSqliteStorage, type SqliteStorage } from './sqlite/index.js';
import { encodeJson, validateId } from './sqlite/validation.js';

export type LocalStorageDomain = 'canvas' | 'conversations';

export interface LocalStorageStatus {
  schemaVersion: 1;
  backend: 'sqlite';
  domains: LocalStorageDomain[];
}

export interface LocalStorageOptions {
  root: string;
  nativeBinding?: string;
  resolveNativeBinding?: () => string | undefined | Promise<string | undefined>;
}

export interface LegacyCanvasWorkspace {
  workspaceId: string;
  metadata: JsonObject;
  nodes: EntityRecord[];
  placements: EntityRecord[];
  edges: EntityRecord[];
}

export interface ActivateLocalCanvasStorageOptions extends LocalStorageOptions {
  loadLegacyWorkspaces: () => Promise<LegacyCanvasWorkspace[]>;
}

export interface LegacyCanvasWriteOptions extends Pick<LocalStorageOptions, 'nativeBinding' | 'resolveNativeBinding'> {
  domain?: LocalStorageDomain;
  /** For host manifests/tags that remain file-backed after Canvas activation. */
  allowActive?: boolean;
}

const MARKER_FILE = '__storage__.json';
const DATABASE_FILE = '__storage__.sqlite';
const LOCK_DIRECTORY = '__storage_migration__.lock';
const legacyWriters = new AsyncLocalStorage<Map<string, { active: boolean }>>();
const legacyWriteTails = new Map<string, Promise<void>>();

function validateRoot(root: string): void {
  if (typeof root !== 'string' || !isAbsolute(root)) {
    throw new StorageError('invalid_argument', 'Local storage requires an absolute root directory');
  }
}

function hasCode(error: unknown, code: string): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === code;
}

function localError(message: string, cause: unknown): StorageError {
  return isStorageError(cause) ? cause : new StorageError('storage_unavailable', message, { cause });
}

/** Missing filesystem metadata never makes an existing authoritative database a legacy store. */
export async function readLocalStorageStatus(
  root: string,
  options: Pick<LocalStorageOptions, 'nativeBinding' | 'resolveNativeBinding'> = {},
): Promise<LocalStorageStatus | null> {
  validateRoot(root);
  let text: string;
  try {
    text = await readFile(join(root, MARKER_FILE), 'utf8');
  } catch (error) {
    if (hasCode(error, 'ENOENT')) {
      try { await stat(join(root, DATABASE_FILE)); }
      catch (missing) { if (hasCode(missing, 'ENOENT')) return null; throw missing; }
      const storage = await openSqliteStorage({
        path: join(root, DATABASE_FILE),
        nativeBinding: options.nativeBinding ?? await options.resolveNativeBinding?.(),
        fileMustExist: true,
      });
      try {
        const states = await storage.localActivation.read();
        if (!states.length || states.some(state => state.state === 'unknown')) {
          throw new StorageError('corrupt_data', 'Activation marker is missing and database authority is unknown; restore verified activation metadata before continuing');
        }
        const domains = states.filter(state => state.state === 'active').map(state => state.domain);
        return domains.length ? { schemaVersion: 1, backend: 'sqlite', domains } : null;
      } finally { await storage.close(); }
    }
    throw localError('Could not read the local storage activation marker', error);
  }
  let marker: unknown;
  try {
    marker = JSON.parse(text);
  } catch (cause) {
    throw new StorageError('corrupt_data', 'The local storage activation marker is invalid JSON', { cause });
  }
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) {
    throw new StorageError('corrupt_data', 'The local storage activation marker must be an object');
  }
  const value = marker as Record<string, unknown>;
  if (value.schemaVersion !== 1 || value.backend !== 'sqlite'
    || !Array.isArray(value.domains) || value.domains.length === 0
    || new Set(value.domains).size !== value.domains.length
    || value.domains.some(domain => domain !== 'canvas' && domain !== 'conversations')) {
    throw new StorageError('unsupported_schema', 'Unsupported local storage activation marker');
  }
  return { schemaVersion: 1, backend: 'sqlite', domains: value.domains as LocalStorageDomain[] };
}

/** Open completed database authority, repairing a missing or stale marker under the shared lock. */
export async function openLocalStorage(options: LocalStorageOptions): Promise<SqliteStorage | null> {
  const status = await readLocalStorageStatus(options.root, options);
  if (!status) return null;
  const path = join(options.root, DATABASE_FILE);
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size === 0) {
      throw new StorageError('storage_unavailable', 'Active SQLite storage is missing or empty; restore it before continuing');
    }
  } catch (error) {
    throw localError('Active SQLite storage is unavailable; restore it before continuing', error);
  }
  const storage = await openSqliteStorage({
    path, nativeBinding: options.nativeBinding ?? await options.resolveNativeBinding?.(), fileMustExist: true,
  });
  try {
    await storage.localActivation.adoptLegacyMarker(status.domains);
    const activeDomains = (await storage.localActivation.read()).filter(state => state.state === 'active').map(state => state.domain);
    const markerMissing = await stat(join(options.root, MARKER_FILE)).then(() => false, error => {
      if (hasCode(error, 'ENOENT')) return true;
      throw error;
    });
    if (markerMissing || encodeJson([...status.domains].sort()) !== encodeJson(activeDomains)) {
      const repair = async () => {
        const domains = (await storage.localActivation.read()).filter(state => state.state === 'active').map(state => state.domain);
        await writeJsonAtomic(join(options.root, MARKER_FILE), { schemaVersion: 1, backend: 'sqlite', domains });
      };
      if (activeLegacyWriter(options.root)) await repair();
      else await enqueueLegacyWrite(options.root, () => withStorageLock(options.root, repair));
    }
    return storage;
  } catch (error) {
    await storage.close();
    throw error;
  }
}

function activeLegacyWriter(root: string): boolean {
  return legacyWriters.getStore()?.get(resolve(root))?.active === true;
}

async function assertLegacyBackend(
  root: string,
  allowActive: boolean,
  domain: LocalStorageDomain = 'canvas',
  options: Pick<LocalStorageOptions, 'nativeBinding' | 'resolveNativeBinding'> = {},
): Promise<void> {
  let status = await readLocalStorageStatus(root, options);
  if (!allowActive && status && !status.domains.includes(domain)) {
    // A crash can leave a valid marker for only the first activated domain.
    // Verify that projection before allowing legacy writes to another domain.
    const storage = await openLocalStorage({ root, ...options });
    await storage?.close();
    status = await readLocalStorageStatus(root, options);
  }
  if (status?.domains.includes(domain) && !allowActive) {
    throw new StorageError('storage_unavailable', `${domain} uses SQLite storage; select the active backend before writing`);
  }
}

/** A fallback check for legacy operations that cannot hold the complete write lock. */
export async function assertLegacyCanvasWritable(root: string): Promise<void> {
  validateRoot(root);
  if (!activeLegacyWriter(root)) {
    try {
      await lstat(join(root, LOCK_DIRECTORY));
      throw new StorageError('storage_busy', 'Local storage is locked by a writer or migration');
    } catch (error) {
      if (!hasCode(error, 'ENOENT')) throw localError('Could not check the local storage write lock', error);
    }
  }
  await assertLegacyBackend(root, false);
}

async function withStorageLock<T>(root: string, operation: () => Promise<T>): Promise<T> {
  validateRoot(root);
  const lockPath = join(root, LOCK_DIRECTORY);
  try {
    await mkdir(root, { recursive: true });
    try {
      await mkdir(lockPath);
    } catch (error) {
      if (!hasCode(error, 'EEXIST') || !await recoverDeadStorageLock(lockPath)) throw error;
      await mkdir(lockPath);
    }
  } catch (error) {
    if (hasCode(error, 'EEXIST')) {
      throw new StorageError('storage_busy', `Storage is locked by a writer or migration, or needs manual lock recovery: ${lockPath}`, { cause: error });
    }
    throw localError('Could not acquire the local storage lock', error);
  }
  try {
    await writeJsonAtomic(join(lockPath, 'owner.json'), { pid: process.pid, token: randomUUID() });
    const owners = new Map(legacyWriters.getStore());
    const owner = { active: true };
    owners.set(resolve(root), owner);
    try { return await legacyWriters.run(owners, operation); }
    finally { owner.active = false; }
  } finally {
    try {
      await unlink(join(lockPath, 'owner.json')).catch(error => {
        if (!hasCode(error, 'ENOENT')) throw error;
      });
      await rmdir(lockPath);
    } catch (error) {
      throw localError(`Could not release the storage lock; manual recovery is required: ${lockPath}`, error);
    }
  }
}

async function readLockOwner(lockPath: string): Promise<{ pid: number; token: string } | null> {
  try {
    const info = await lstat(lockPath);
    if (!info.isDirectory() || info.isSymbolicLink()) return null;
    const value = JSON.parse(await readFile(join(lockPath, 'owner.json'), 'utf8'));
    if (!Number.isSafeInteger(value.pid) || value.pid < 1
      || typeof value.token !== 'string' || !/^[a-f0-9-]{36}$/.test(value.token)) return null;
    return value;
  } catch {
    return null;
  }
}

/** Recover only a provably dead process; never expire a live writer by elapsed time. */
async function recoverDeadStorageLock(lockPath: string): Promise<boolean> {
  const owner = await readLockOwner(lockPath);
  if (!owner) return false;
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    if (!hasCode(error, 'ESRCH')) return false;
  }
  // Recheck after proving death: the old process may have released its lock
  // before exiting and another writer may already own this pathname.
  if ((await readLockOwner(lockPath))?.token !== owner.token) return false;
  try {
    // Keep this non-empty quarantine. Concurrent recoverers with the old token
    // cannot rename a newly acquired lock over it (ENOTEMPTY/EEXIST).
    await rename(lockPath, `${lockPath}.recovered-${owner.token}`);
    return true;
  } catch {
    return false;
  }
}

async function enqueueLegacyWrite<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const key = resolve(root);
  const pending = (legacyWriteTails.get(key) ?? Promise.resolve()).then(operation);
  const tail = pending.then(() => undefined, () => undefined);
  legacyWriteTails.set(key, tail);
  try {
    return await pending;
  } finally {
    if (legacyWriteTails.get(key) === tail) legacyWriteTails.delete(key);
  }
}

/** Legacy writes and activation share one lock; nested writes in its owner are safe. */
export async function withLegacyCanvasWrite<T>(
  root: string,
  operation: () => Promise<T>,
  options: LegacyCanvasWriteOptions = {},
): Promise<T> {
  validateRoot(root);
  if (activeLegacyWriter(root)) {
    await assertLegacyBackend(root, options.allowActive === true, options.domain, options);
    return operation();
  }
  return enqueueLegacyWrite(root, () => withStorageLock(root, async () => {
    await assertLegacyBackend(root, options.allowActive === true, options.domain, options);
    return operation();
  }));
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const contents = `${encodeJson(value)}\n`;
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let ownsTemporary = false;
  try {
    const file = await open(temporary, 'wx', 0o600);
    ownsTemporary = true;
    try {
      await file.writeFile(contents, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    ownsTemporary = false;
    // Persist the rename as well as the file contents before exposing authority.
    if (process.platform !== 'win32') {
      const directory = await open(dirname(path), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
  } finally {
    if (ownsTemporary) await unlink(temporary).catch(() => undefined);
  }
}

function freezeLegacySnapshots(input: LegacyCanvasWorkspace[]): LegacyCanvasWorkspace[] {
  if (!Array.isArray(input)) throw new StorageError('invalid_argument', 'Legacy workspaces must be an array');
  const snapshots = JSON.parse(encodeJson(input)) as LegacyCanvasWorkspace[];
  const ids = new Set<string>();
  for (const snapshot of snapshots) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      throw new StorageError('invalid_argument', 'Each legacy workspace must be an object');
    }
    validateId(snapshot.workspaceId, 'workspace id');
    if (ids.has(snapshot.workspaceId)) {
      throw new StorageError('invalid_argument', `Duplicate legacy workspace id: ${snapshot.workspaceId}`);
    }
    ids.add(snapshot.workspaceId);
    if (!snapshot.metadata || typeof snapshot.metadata !== 'object' || Array.isArray(snapshot.metadata)
      || !Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.placements) || !Array.isArray(snapshot.edges)) {
      throw new StorageError('invalid_argument', `Invalid legacy workspace snapshot: ${snapshot.workspaceId}`);
    }
    for (const records of [snapshot.nodes, snapshot.placements, snapshot.edges]) {
      for (const record of records) {
        if (!record || typeof record !== 'object' || Array.isArray(record)) {
          throw new StorageError('invalid_argument', 'Each legacy record must be an object');
        }
        validateId(record.id, 'record id');
      }
    }
  }
  return snapshots;
}

function replacement(previous: EntityRecord[], next: EntityRecord[]): RecordChanges {
  const ids = new Set(next.map(record => record.id));
  return { put: next, remove: previous.filter(record => !ids.has(record.id)).map(record => record.id) };
}

async function importSnapshots(storage: PulseStorage, snapshots: LegacyCanvasWorkspace[]): Promise<void> {
  for (const snapshot of snapshots) {
    const previous = await storage.canvas.read(snapshot.workspaceId);
    await storage.canvas.commit({
      workspaceId: snapshot.workspaceId,
      expectedRevision: previous?.revision ?? null,
      metadata: snapshot.metadata,
      nodes: replacement(previous?.nodes ?? [], snapshot.nodes),
      placements: replacement(previous?.placements ?? [], snapshot.placements),
      edges: replacement(previous?.edges ?? [], snapshot.edges),
    });
  }
  const retained = new Set(snapshots.map(snapshot => snapshot.workspaceId));
  let cursor: string | undefined;
  do {
    const page = await storage.canvas.list({ cursor, limit: 500 });
    for (const workspace of page.items) {
      if (!retained.has(workspace.workspaceId)) await storage.canvas.remove(workspace.workspaceId, workspace.revision);
    }
    cursor = page.nextCursor;
  } while (cursor !== undefined);
}

/**
 * The App owns the legacy reader and decides when to activate. This first-stage
 * migration covers Canvas structure only; host manifests/tags and Markdown or
 * attachment files stay untouched. The DB records completed cutovers; the file
 * marker is a mirror. Older binaries cannot honor this lock and must stop before activation; the second
 * source read detects changes but cannot replace their participation in locking.
 */
export async function activateLocalCanvasStorage(options: ActivateLocalCanvasStorageOptions): Promise<PulseStorage> {
  if ((await readLocalStorageStatus(options.root, options))?.domains.includes('canvas')) {
    return (await openLocalStorage(options))!;
  }
  const connection: { storage: SqliteStorage | null } = { storage: null };
  try {
    return await withStorageLock(options.root, async () => {
      // Another activation may have finished between the first check and our lock.
      let storage = await openLocalStorage(options);
      connection.storage = storage;
      const status = await readLocalStorageStatus(options.root, options);
      if (storage && status?.domains.includes('canvas')) return storage;
      const snapshots = freezeLegacySnapshots(await options.loadLegacyWorkspaces());
      const backupDirectory = join(options.root, '__storage-backup__');
      await mkdir(backupDirectory, { recursive: true });
      await writeJsonAtomic(join(backupDirectory, `canvas-${randomUUID()}.json`), {
        schemaVersion: 1,
        domain: 'canvas',
        createdAt: new Date().toISOString(),
        snapshots,
      });
      storage ??= await openSqliteStorage({
        path: join(options.root, DATABASE_FILE),
        nativeBinding: options.nativeBinding ?? await options.resolveNativeBinding?.(),
      });
      connection.storage = storage;
      await storage.localActivation.begin('canvas');
      await importSnapshots(storage, snapshots);
      const integrity = await storage.checkIntegrity();
      if (!integrity.ok) {
        throw new StorageError('corrupt_data', `Imported storage failed integrity checks: ${integrity.issues.join('; ')}`);
      }
      const latest = freezeLegacySnapshots(await options.loadLegacyWorkspaces());
      if (encodeJson(latest) !== encodeJson(snapshots)) {
        throw new StorageError('revision_conflict', 'Legacy Canvas changed during migration; retry from the latest files');
      }
      await storage.localActivation.complete('canvas');
      await writeJsonAtomic(join(options.root, MARKER_FILE), {
        schemaVersion: 1, backend: 'sqlite', domains: [...(status?.domains ?? []), 'canvas'],
      } satisfies LocalStorageStatus);
      return storage;
    });
  } catch (error) {
    await connection.storage?.close().catch(() => undefined);
    throw localError('Local Canvas storage migration failed', error);
  }
}
