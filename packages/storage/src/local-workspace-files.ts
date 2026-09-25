import { createHash, randomUUID } from 'node:crypto';
import { constants, promises as fs, watch } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { StorageError } from './errors.js';
import {
  sameFileVersion,
  type FileBytes,
  type FileContentVersion,
  type FileText,
  type FileWriteOptions,
  type FileWriteReceipt,
  type WorkspaceFiles,
} from './workspace-files.js';

/** The single content version scheme shared by reads, writes and write intents. */
export function fileContentVersion(bytes: Uint8Array): FileContentVersion {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function hasCode(error: unknown, code: string): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === code;
}

function pathFromUri(uri: string): string {
  let url: URL;
  try { url = new URL(uri); }
  catch (cause) { throw new StorageError('invalid_argument', 'Invalid local file URI.', { cause }); }
  // A host is only meaningful as a Windows UNC share, e.g. \\server\share\note.md.
  const remoteHost = !!url.host && url.host !== 'localhost' && process.platform !== 'win32';
  if (url.protocol !== 'file:' || url.search || url.hash || remoteHost) {
    throw new StorageError('invalid_argument', 'The local file adapter only accepts file: resources.');
  }
  return fileURLToPath(url);
}

/**
 * The real file behind a path. A file reached through a symlink is edited in
 * place; a dangling symlink is never replaced by a regular file.
 */
async function targetPath(path: string, mayCreate: boolean): Promise<string> {
  try { return await fs.realpath(path); }
  catch (error) {
    if (!mayCreate || !hasCode(error, 'ENOENT')) throw error;
    const entry = await fs.lstat(path).catch(() => null);
    if (entry?.isSymbolicLink()) throw error;
    return join(await fs.realpath(dirname(resolve(path))), basename(path));
  }
}

async function readAt(path: string): Promise<{ bytes: Uint8Array; version: FileContentVersion } | null> {
  let handle: fs.FileHandle;
  try { handle = await fs.open(path, constants.O_RDONLY | constants.O_NONBLOCK); }
  catch (error) {
    if (hasCode(error, 'ENOENT')) return null;
    throw error;
  }
  try {
    if (!(await handle.stat()).isFile()) throw new StorageError('invalid_argument', 'Expected a regular file.');
    const bytes = await handle.readFile();
    return { bytes, version: fileContentVersion(bytes) };
  } finally {
    await handle.close();
  }
}

const conflict = (message: string) => new StorageError('revision_conflict', message);

/** Local adapter: atomic same-directory replacement guarded by content versions. */
export function createLocalWorkspaceFiles(): WorkspaceFiles {
  // One write at a time per real file inside this process.
  const lanes = new Map<string, Promise<unknown>>();
  const inLane = async <T>(target: string, operation: () => Promise<T>): Promise<T> => {
    const previous = lanes.get(target) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(operation);
    lanes.set(target, run);
    try { return await run; }
    finally { if (lanes.get(target) === run) lanes.delete(target); }
  };

  const matches = async (target: string, expected: FileContentVersion | null): Promise<boolean> => {
    const current = await readAt(target);
    return expected === null ? current === null : sameFileVersion(current?.version, expected);
  };

  const createOnly = async (target: string, bytes: Uint8Array): Promise<void> => {
    let handle: fs.FileHandle;
    try { handle = await fs.open(target, 'wx', 0o666); }
    catch (error) {
      if (hasCode(error, 'EEXIST')) throw conflict('The file already exists.');
      throw error;
    }
    try { await handle.writeFile(bytes); await handle.sync(); }
    finally { await handle.close(); }
  };

  const replace = async (path: string, target: string, bytes: Uint8Array, expected?: FileContentVersion): Promise<void> => {
    const metadata = await fs.stat(target).catch((error: unknown) => {
      if (expected === undefined && hasCode(error, 'ENOENT')) return null;
      throw error;
    });
    if (metadata && !metadata.isFile()) throw new StorageError('invalid_argument', 'Expected a regular file.');
    if (metadata) await fs.access(target, constants.W_OK);
    const temporary = join(dirname(target), `.pulse-edit-${randomUUID()}`);
    try {
      const handle = await fs.open(temporary, 'wx', metadata?.mode ?? 0o666);
      try { await handle.writeFile(bytes); await handle.sync(); }
      finally { await handle.close(); }
      if (metadata) await fs.chmod(temporary, metadata.mode);
      // Other editors share no lock: re-check right before the atomic rename.
      if (await targetPath(path, expected === undefined) !== target
        || (expected !== undefined && !(await matches(target, expected)))) {
        throw conflict('The file changed outside this editor. Reload before saving.');
      }
      await fs.rename(temporary, target);
    } finally {
      await fs.unlink(temporary).catch(() => undefined);
    }
  };

  const files: WorkspaceFiles = {
    uriForPath(path) {
      if (typeof path !== 'string' || !isAbsolute(path)) {
        throw new StorageError('invalid_argument', 'A workspace file requires an absolute path.');
      }
      return pathToFileURL(resolve(path)).href;
    },

    localPath: pathFromUri,

    async readBytes(uri): Promise<FileBytes | null> {
      const read = await readAt(pathFromUri(uri));
      return read ? { uri, ...read } : null;
    },

    async readText(uri): Promise<FileText | null> {
      const read = await files.readBytes(uri);
      return read ? { uri, version: read.version, content: Buffer.from(read.bytes).toString('utf8') } : null;
    },

    async write(uri, content, options: FileWriteOptions = {}): Promise<FileWriteReceipt> {
      const path = pathFromUri(uri);
      const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
      const expected = options.expectedVersion;
      const target = await targetPath(path, expected === undefined || expected === null).catch(error => {
        if (typeof expected === 'string' && hasCode(error, 'ENOENT')) throw conflict('The file no longer exists.');
        throw error;
      });
      return inLane(target, async () => {
        if (expected === null) await createOnly(target, bytes);
        else {
          if (expected !== undefined && !(await matches(target, expected))) {
            throw conflict('The file changed outside this editor. Reload before saving.');
          }
          await replace(path, target, bytes, expected);
        }
        return { uri, version: fileContentVersion(bytes) };
      });
    },

    async remove(uri, options = {}) {
      // Remove the addressed entry itself: a symlink is unlinked, never the
      // file it points to, which may live outside the workspace.
      const path = pathFromUri(uri);
      const entry = await fs.lstat(path).catch(error => {
        if (hasCode(error, 'ENOENT')) return null;
        throw error;
      });
      if (!entry) {
        if (options.expectedVersion !== undefined) throw conflict('The file no longer exists.');
        return;
      }
      if (entry.isDirectory()) throw new StorageError('invalid_argument', 'Expected a file, not a directory.');
      const lane = entry.isSymbolicLink() ? await fs.realpath(path).catch(() => path) : path;
      await inLane(lane, async () => {
        if (options.expectedVersion !== undefined && !(await matches(path, options.expectedVersion))) {
          throw conflict('The file changed before it could be removed.');
        }
        await fs.unlink(path).catch(error => {
          if (!hasCode(error, 'ENOENT') || options.expectedVersion !== undefined) throw error;
        });
      });
    },

    watchDirectory(uri, onChange, onError) {
      const watcher = watch(pathFromUri(uri), { persistent: false }, () => onChange());
      watcher.on('error', () => {
        watcher.close();
        onError?.();
      });
      return () => watcher.close();
    },
  };
  return files;
}
