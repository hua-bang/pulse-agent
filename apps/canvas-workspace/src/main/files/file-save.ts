import { randomUUID } from 'node:crypto';
import { access, chmod, lstat, open, realpath, rename, stat, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import type { FileReadResult, FileSaveRequest, FileSaveResult, FileWriteRequest } from '../../shared/files';
import { FILE_PREVIEW_MAX_BYTES, readFilePreview, fileVersion } from './file-preview';

const lanes = new Map<string, Promise<unknown>>();
const conflict = (): FileSaveResult => ({
  ok: false, conflict: true, error: 'File changed outside this editor. Reload before saving.',
});

/** Full note reads retain their historical size support and hash the exact bytes. */
export async function readTextFile(filePath: string): Promise<FileReadResult> {
  try {
    if (typeof filePath !== 'string' || !filePath) throw new Error('Expected a file path');
    const file = await open(filePath, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      if (!(await file.stat()).isFile()) throw new Error('Expected a regular file');
      const bytes = await file.readFile();
      return { ok: true, content: bytes.toString('utf8'), version: fileVersion(bytes) };
    } finally {
      await file.close();
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function targetPath(filePath: string, mayCreate: boolean): Promise<string> {
  try { return await realpath(filePath); }
  catch (error: any) {
    if (!mayCreate || error?.code !== 'ENOENT') throw error;
    // Never replace a dangling symlink itself when its target cannot be resolved.
    const entry = await lstat(filePath).catch(() => null);
    if (entry?.isSymbolicLink()) throw error;
    return join(await realpath(dirname(resolve(filePath))), basename(filePath));
  }
}

async function saveFile(request: FileWriteRequest, preview: boolean): Promise<FileSaveResult> {
  if (!request || typeof request.filePath !== 'string' || !request.filePath
    || typeof request.content !== 'string'
    || (request.expectedVersion !== undefined && (typeof request.expectedVersion !== 'string' || !request.expectedVersion))) {
    return { ok: false, error: 'Invalid file save request' };
  }
  const conditional = request.expectedVersion !== undefined;
  const readVersion = async (target: string): Promise<string | undefined> => {
    if (!preview) {
      const result = await readTextFile(target);
      return result.ok ? result.version : undefined;
    }
    const result = await readFilePreview(target);
    return result.ok && result.kind === 'text' ? result.version : undefined;
  };
  try {
    const target = await targetPath(request.filePath, !conditional);
    const previous = lanes.get(target) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(async (): Promise<FileSaveResult> => {
      if (conditional && await readVersion(target) !== request.expectedVersion) return conflict();
      const metadata = await stat(target).catch((error: NodeJS.ErrnoException) => {
        if (!conditional && error.code === 'ENOENT') return null;
        throw error;
      });
      if (metadata && !metadata.isFile()) return { ok: false, error: 'Expected a regular file' };
      if (metadata) await access(target, constants.W_OK);
      const temporary = join(dirname(target), `.pulse-edit-${randomUUID()}`);
      try {
        const file = await open(temporary, 'wx', metadata?.mode ?? 0o666);
        try { await file.writeFile(request.content, 'utf8'); await file.sync(); }
        finally { await file.close(); }
        if (metadata) await chmod(temporary, metadata.mode);
        if (await targetPath(request.filePath, !conditional) !== target
          || (conditional && await readVersion(target) !== request.expectedVersion)) return conflict();
        await rename(temporary, target);
        return { ok: true, version: fileVersion(Buffer.from(request.content)) };
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
    });
    lanes.set(target, operation);
    try { return await operation; }
    finally { if (lanes.get(target) === operation) lanes.delete(target); }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Ordinary notes have no preview limit; unversioned callers retain overwrite/create semantics. */
export const saveTextFile = (request: FileWriteRequest): Promise<FileSaveResult> => saveFile(request, false);

/** Dock previews keep their independent bounded UTF-8 policy. */
export const saveFilePreview = async (request: FileSaveRequest): Promise<FileSaveResult> => {
  if (!request || typeof request.filePath !== 'string' || !isAbsolute(request.filePath)
    || typeof request.content !== 'string' || typeof request.expectedVersion !== 'string'
    || !request.expectedVersion || Buffer.byteLength(request.content) > FILE_PREVIEW_MAX_BYTES
    || request.content.includes('\0')) return { ok: false, error: 'Invalid file save request' };
  return saveFile(request, true);
};
