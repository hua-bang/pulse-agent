import { isAbsolute, resolve } from 'node:path';
import { isStorageError } from '@pulse-coder/storage';
import type { FileReadResult, FileSaveRequest, FileSaveResult, FileWriteRequest } from '../../shared/files';
import { FILE_PREVIEW_MAX_BYTES } from './file-preview';
import { workspaceFiles } from './workspace-files';

const conflict = (): FileSaveResult => ({
  ok: false, conflict: true, error: 'File changed outside this editor. Reload before saving.',
});
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Full note reads retain their historical size support and hash the exact bytes. */
export async function readTextFile(filePath: string): Promise<FileReadResult> {
  try {
    if (typeof filePath !== 'string' || !filePath) throw new Error('Expected a file path');
    const read = await workspaceFiles.readText(workspaceFiles.uriForPath(resolve(filePath)));
    if (!read) throw new Error(`ENOENT: no such file or directory, open '${filePath}'`);
    return { ok: true, content: read.content, version: read.version };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

async function saveFile(request: FileWriteRequest): Promise<FileSaveResult> {
  if (!request || typeof request.filePath !== 'string' || !request.filePath
    || typeof request.content !== 'string'
    || (request.expectedVersion !== undefined && (typeof request.expectedVersion !== 'string' || !request.expectedVersion))) {
    return { ok: false, error: 'Invalid file save request' };
  }
  try {
    // The repository serializes writes per real file, so ordinary notes and
    // preview edits of the same file share one compare-and-swap lane.
    const receipt = await workspaceFiles.write(
      workspaceFiles.uriForPath(resolve(request.filePath)),
      request.content,
      request.expectedVersion === undefined ? {} : { expectedVersion: request.expectedVersion },
    );
    return { ok: true, version: receipt.version };
  } catch (error) {
    if (isStorageError(error) && error.code === 'revision_conflict') return conflict();
    return { ok: false, error: message(error) };
  }
}

/** Ordinary notes have no preview limit; unversioned callers retain overwrite/create semantics. */
export const saveTextFile = (request: FileWriteRequest): Promise<FileSaveResult> => saveFile(request);

/** Dock previews keep their independent bounded UTF-8 policy. */
export const saveFilePreview = async (request: FileSaveRequest): Promise<FileSaveResult> => {
  if (!request || typeof request.filePath !== 'string' || !isAbsolute(request.filePath)
    || typeof request.content !== 'string' || typeof request.expectedVersion !== 'string'
    || !request.expectedVersion || Buffer.byteLength(request.content) > FILE_PREVIEW_MAX_BYTES
    || request.content.includes('\0')) return { ok: false, error: 'Invalid file save request' };
  return saveFile(request);
};
