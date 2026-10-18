import { realpath } from 'fs/promises';
import { basename, dirname, join } from 'path';

// Shared by built-in edit and write calls in this module instance. These tails
// never reject: a failed mutation must not poison the next queued operation.
const pending = new Map<string, Promise<void>>();

async function mutationKey(filePath: string): Promise<string> {
  try {
    // Resolve on the filesystem before normalizing: link/../file can refer
    // to a different file from the lexically normalized path.
    return await realpath(filePath);
  } catch (error) {
    // write may create a file and its parents. Resolve the existing ancestor
    // so a symlinked directory and its real path use the same queue.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const parent = dirname(filePath);
    if (parent === filePath) throw error;
    return join(await mutationKey(parent), basename(filePath));
  }
}

export async function withFileMutation<T>(filePath: string, mutate: () => Promise<T>): Promise<T> {
  const key = await mutationKey(filePath);
  const previous = pending.get(key);
  let release!: () => void;
  const current = new Promise<void>((done) => { release = done; });
  pending.set(key, current);

  try {
    await previous;
    return await mutate();
  } finally {
    release();
    // A newer waiter owns the entry until its own operation completes.
    if (pending.get(key) === current) pending.delete(key);
  }
}
