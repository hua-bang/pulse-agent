import { randomUUID } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { CommitReceipt, PulseStorage } from './contracts.js';
import type { FileWriteInput, FileWriteRecord, FileWriteRepository, FileWriteStatus } from './file-contracts.js';
import { StorageError } from './errors.js';
import { fileContentVersion } from './local-workspace-files.js';

type RecoveryStorage = Pick<PulseStorage, 'canvas'> & { fileWrites: FileWriteRepository };

export interface LocalFileWriteResult {
  id: string;
  workspaceId: string;
  nodeId: string;
  uri: string;
  status: FileWriteStatus;
  error?: string;
  canvasCommit?: CommitReceipt;
}

export interface LocalFileRecoveryReport {
  ok: boolean;
  items: LocalFileWriteResult[];
  applied: number;
  conflicts: number;
  errors: number;
}

interface FileState {
  version: string | null;
  content: string | null;
  mode: number;
}

function hasCode(error: unknown, code: string): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === code;
}

function validateText(content: string): void {
  if (typeof content !== 'string' || Buffer.from(content, 'utf8').toString('utf8') !== content) {
    throw new StorageError('invalid_argument', 'Local file writes require UTF-8 text.');
  }
}

export function localFileVersion(content: string): string {
  validateText(content);
  return fileContentVersion(Buffer.from(content, 'utf8'));
}

/** Resolve existing parent symlinks while allowing a not-yet-created notes folder. */
async function canonicalTarget(path: string): Promise<string> {
  if (typeof path !== 'string' || !isAbsolute(path)) {
    throw new StorageError('invalid_argument', 'A local file write requires an absolute path.');
  }
  const absolute = resolve(path);
  let parent = dirname(absolute);
  const missing: string[] = [];
  while (true) {
    try {
      const canonical = await fs.realpath(parent);
      if (!(await fs.stat(canonical)).isDirectory()) {
        throw new StorageError('invalid_argument', 'A file target parent must be a directory.');
      }
      return join(canonical, ...missing, basename(absolute));
    } catch (error) {
      if (!hasCode(error, 'ENOENT') || dirname(parent) === parent) throw error;
      missing.unshift(basename(parent));
      parent = dirname(parent);
    }
  }
}

async function readRegularFile(path: string): Promise<FileState> {
  try {
    const info = await fs.lstat(path);
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new StorageError('invalid_argument', 'A file write target must be a regular file, not a link or directory.');
    }
    const handle = await fs.open(path, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = await handle.stat();
      if (!opened.isFile()) throw new StorageError('invalid_argument', 'A file target changed to a non-regular file.');
      const bytes = await handle.readFile();
      const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      return { content, version: localFileVersion(content), mode: opened.mode & 0o777 };
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return { content: null, version: null, mode: 0o600 };
    throw error;
  }
}

export async function prepareLocalFileWrite(
  path: string,
  nodeId: string,
  content: string,
  expectedVersion?: string | null,
): Promise<FileWriteInput> {
  if (typeof nodeId !== 'string' || !nodeId || nodeId.length > 1024 || /[\u0000-\u001f]/.test(nodeId)) {
    throw new StorageError('invalid_argument', 'Invalid file node id.');
  }
  validateText(content);
  const canonical = await canonicalTarget(path);
  const current = await readRegularFile(canonical);
  if (expectedVersion !== undefined && expectedVersion !== current.version) {
    throw new StorageError('revision_conflict', 'The source file changed before the write was prepared.');
  }
  return {
    id: randomUUID(),
    nodeId,
    uri: pathToFileURL(canonical).href,
    baseVersion: current.version,
    targetVersion: localFileVersion(content),
    baseContent: current.content,
    content,
  };
}

async function localTarget(intent: FileWriteInput): Promise<string> {
  validateText(intent.content);
  if (intent.baseContent !== null) validateText(intent.baseContent);
  if (intent.targetVersion !== localFileVersion(intent.content)
    || intent.baseVersion !== (intent.baseContent === null ? null : localFileVersion(intent.baseContent))) {
    throw new StorageError('corrupt_data', 'File recovery snapshots do not match their recorded versions.');
  }
  let url: URL;
  try { url = new URL(intent.uri); }
  catch (cause) { throw new StorageError('invalid_argument', 'Invalid local file URI.', { cause }); }
  if (url.protocol !== 'file:' || url.search || url.hash || (url.host && url.host !== 'localhost')) {
    throw new StorageError('invalid_argument', 'The local file adapter only accepts canonical file: resources.');
  }
  const path = await canonicalTarget(fileURLToPath(url));
  if (pathToFileURL(path).href !== intent.uri) {
    throw new StorageError('revision_conflict', 'The file resource path changed since the intent was prepared.');
  }
  return path;
}

function outcome(record: FileWriteRecord, canvasCommit?: CommitReceipt): LocalFileWriteResult {
  return {
    id: record.id, workspaceId: record.workspaceId, nodeId: record.nodeId,
    uri: record.uri, status: record.status,
    ...(record.error === undefined ? {} : { error: record.error }),
    ...(canvasCommit ? { canvasCommit } : {}),
  };
}

async function settle(
  storage: RecoveryStorage,
  record: FileWriteRecord,
  status: 'applied' | 'conflict',
  error?: string,
): Promise<LocalFileWriteResult> {
  const result = await storage.fileWrites.settle(record.id, { status, ...(error === undefined ? {} : { error }) });
  return outcome(result.record, result.canvasCommit);
}

async function checkNodeOwnership(storage: RecoveryStorage, record: FileWriteRecord): Promise<boolean> {
  const node = await storage.canvas.readNode(record.workspaceId, record.nodeId);
  const data = node?.data;
  if (!node || node.type !== 'file' || !data || typeof data !== 'object' || Array.isArray(data)
    || data.fileWriteIntentId !== record.id || data.content !== record.content) return false;
  if (typeof data.filePath === 'string') {
    return pathToFileURL(await canonicalTarget(data.filePath)).href === record.uri;
  }
  return true;
}

async function recoverOne(storage: RecoveryStorage, record: FileWriteRecord): Promise<LocalFileWriteResult> {
  let temporary: string | undefined;
  try {
    const path = await localTarget(record);
    const current = await readRegularFile(path);
    if (current.version === record.targetVersion) return await settle(storage, record, 'applied');
    if (record.status === 'conflict') return outcome(record);
    if (current.version !== record.baseVersion) {
      return await settle(storage, record, 'conflict', 'The source changed; base and requested content are retained in the intent.');
    }
    if (!await checkNodeOwnership(storage, record)) {
      return await settle(storage, record, 'conflict', 'A newer node edit superseded this file write.');
    }
    if (current.version !== null) await fs.access(path, constants.W_OK);
    await fs.mkdir(dirname(path), { recursive: true });
    if (pathToFileURL(await canonicalTarget(path)).href !== record.uri) {
      throw new StorageError('revision_conflict', 'The file parent changed before recovery.');
    }
    temporary = join(dirname(path), `.pulse-write-${randomUUID()}.tmp`);
    const handle = await fs.open(temporary, 'wx', current.mode);
    try {
      await handle.writeFile(record.content, 'utf8');
      await handle.chmod(current.mode);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const refreshed = await readRegularFile(path);
    if (refreshed.version === record.targetVersion) return await settle(storage, record, 'applied');
    if (refreshed.version !== record.baseVersion) {
      return await settle(storage, record, 'conflict', 'The source changed while staging the file; both snapshots are retained.');
    }
    const latest = await storage.fileWrites.get(record.id);
    if (!latest) throw new StorageError('not_found', 'The file write was removed before replacement.');
    if (latest.status === 'applied' || latest.status === 'conflict') return outcome(latest);
    if (!await checkNodeOwnership(storage, record)) {
      return await settle(storage, record, 'conflict', 'A newer node edit superseded this staged file write.');
    }
    // Other editors do not share a lock: this is an optimistic hash check plus
    // atomic replacement, not an atomic compare-and-swap against external writers.
    await fs.rename(temporary, path);
    temporary = undefined;
    if (process.platform !== 'win32') {
      const parent = await fs.open(dirname(path), 'r');
      try { await parent.sync(); } finally { await parent.close(); }
    }
    const persisted = await readRegularFile(path);
    if (persisted.version !== record.targetVersion) {
      return await settle(storage, record, 'conflict', 'The source changed after replacement; the requested snapshot is retained.');
    }
    return await settle(storage, record, 'applied');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      const result = await storage.fileWrites.settle(record.id, { status: 'error', error: message });
      return outcome(result.record, result.canvasCommit);
    } catch (persistenceError) {
      // The original durable intent stays pending if even error recording fails.
      return {
        ...outcome(record), status: 'error',
        error: `${message}; outcome recording failed: ${persistenceError instanceof Error ? persistenceError.message : String(persistenceError)}`,
      };
    }
  } finally {
    if (temporary) await fs.unlink(temporary).catch(() => undefined);
  }
}

/** Retry durable work; conflicts may be acknowledged but are never auto-overwritten. */
export async function recoverLocalFileWrites(
  storage: RecoveryStorage,
  options: { workspaceId?: string } = {},
): Promise<LocalFileRecoveryReport> {
  const items: LocalFileWriteResult[] = [];
  let cursor: string | undefined;
  do {
    const page = await storage.fileWrites.list({
      workspaceId: options.workspaceId, statuses: ['pending', 'error', 'conflict'], cursor, limit: 100,
    });
    for (const intent of page.items) items.push(await recoverOne(storage, intent));
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return {
    ok: items.every(item => item.status === 'applied'),
    items,
    applied: items.filter(item => item.status === 'applied').length,
    conflicts: items.filter(item => item.status === 'conflict').length,
    errors: items.filter(item => item.status === 'error').length,
  };
}
