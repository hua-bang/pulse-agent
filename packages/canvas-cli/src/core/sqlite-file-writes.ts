import { resolve } from 'path';
import type { FileWriteInput, FileWriteRecord, PulseStorage } from '@pulse-coder/storage';
import { StorageError } from '@pulse-coder/storage';
import { prepareLocalFileWrite, recoverLocalFileWrites } from '@pulse-coder/storage/local-files';
import type { CanvasNode } from './types';
import type { PreparedContentWrite } from './nodes';

/** Coalesce repeated writes to a node, but reject ambiguous shared-file batches. */
export async function prepareCanvasFileWrites(
  nodes: readonly CanvasNode[],
  writes: readonly PreparedContentWrite[],
): Promise<FileWriteInput[]> {
  const intents = new Map<string, FileWriteInput>();
  for (const write of writes) {
    const matches = nodes.filter(node => node.type === 'file'
      && (write.nodeId ? node.id === write.nodeId
        : typeof node.data.filePath === 'string' && resolve(node.data.filePath) === resolve(write.path)));
    // A create/update followed by deletion has no remaining file mutation.
    if (!matches.length) continue;
    if (matches.length > 1) {
      throw new StorageError('invalid_argument', 'Multiple nodes address this file; select an explicit node for the write.');
    }
    const node = matches[0];
    const content = typeof node.data.content === 'string' ? node.data.content : write.content;
    const intent = await prepareLocalFileWrite(write.path, node.id, content);
    const previous = intents.get(intent.uri);
    if (previous && previous.nodeId !== intent.nodeId) {
      throw new StorageError('invalid_argument', 'One atomic plan cannot write the same file through multiple nodes.');
    }
    intents.set(intent.uri, intent);
  }
  return [...intents.values()];
}

export async function recoverSubmittedFileWrites(
  storage: PulseStorage,
  workspaceId: string,
  writes: readonly FileWriteInput[],
): Promise<Array<FileWriteRecord | { id: string; status: 'missing'; error: string }>> {
  if (!writes.length) return [];
  try {
    await recoverLocalFileWrites(storage, { workspaceId });
    return await Promise.all(writes.map(async write => (
      await storage.fileWrites.get(write.id)
        ?? { id: write.id, status: 'missing' as const, error: 'The file write intent no longer exists.' }
    )));
  } catch (cause) {
    throw new StorageError('file_write_pending',
      `Durable file writes ${writes.map(write => write.id).join(', ')} could not be recovered: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause });
  }
}

export function requireAppliedFileWrites(
  writes: Array<FileWriteRecord | { id: string; status: 'missing'; error: string }>,
): void {
  const unfinished = writes.filter(write => write.status !== 'applied');
  if (!unfinished.length) return;
  const code = unfinished.some(write => write.status === 'conflict' || write.status === 'missing')
    ? 'file_write_conflict' : 'file_write_pending';
  throw new StorageError(code,
    `Canvas committed, but file writes remain incomplete: ${unfinished.map(write => `${write.id} (${write.status})${write.error ? `: ${write.error}` : ''}`).join('; ')}. `
    + 'The durable intents retain both snapshots; inspect doctor and use doctor --repair to retry pending writes.');
}
