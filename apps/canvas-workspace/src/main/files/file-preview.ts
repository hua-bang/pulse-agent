import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileContentVersion } from '@pulse-coder/storage/local-workspace-files';
import type { FilePreviewResult } from '../../shared/files';

/** Same content version scheme as Markdown reads, saves and write intents. */
export const fileVersion = (data: Uint8Array): string => fileContentVersion(data);

export const FILE_PREVIEW_MAX_BYTES = 512 * 1024;

export const readFilePreview = async (filePath: string): Promise<FilePreviewResult> => {
  if (typeof filePath !== 'string' || !isAbsolute(filePath)) {
    return { ok: false, error: 'Expected an absolute file path' };
  }
  try {
    // Nonblocking open also prevents a selected FIFO from hanging the main process.
    const file = await open(filePath, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile()) return { ok: true, kind: 'unsupported' };
      if (stat.size > FILE_PREVIEW_MAX_BYTES) return { ok: true, kind: 'too-large' };
      const bytes = Buffer.alloc(FILE_PREVIEW_MAX_BYTES + 1);
      let size = 0;
      while (size < bytes.length) {
        const { bytesRead } = await file.read(bytes, size, bytes.length - size, size);
        if (!bytesRead) break;
        size += bytesRead;
      }
      if (size > FILE_PREVIEW_MAX_BYTES) return { ok: true, kind: 'too-large' };
      const data = bytes.subarray(0, size);
      if (data.includes(0)) return { ok: true, kind: 'unsupported' };
      try {
        return { ok: true, kind: 'text', content: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data), version: fileVersion(data) };
      } catch {
        return { ok: true, kind: 'unsupported' };
      }
    } finally {
      await file.close();
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};
