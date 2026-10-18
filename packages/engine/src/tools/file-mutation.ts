import { realpath } from 'fs/promises';
import { basename, dirname, join, resolve } from 'path';

// Shared by built-in edit and write calls in this module instance. These tails
// never reject: a failed mutation must not poison the next queued operation.
const pending = new Map<string, Promise<void>>();

async function mutationKey(filePath: string): Promise<string> {
  const absolute = resolve(filePath);
  try {
    return await realpath(absolute);
  } catch (error) {
    // write may create a file and its parents. Resolve the existing ancestor
    // so a symlinked directory and its real path use the same queue.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const parent = dirname(absolute);
    if (parent === absolute) throw error;
    return join(await mutationKey(parent), basename(absolute));
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
