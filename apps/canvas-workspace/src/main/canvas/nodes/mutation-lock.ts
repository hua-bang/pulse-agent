// In-process storage mutations are serialized by their final file path. The
// keyed tails keep unrelated node/tag files independent while ensuring every
// read-modify-write flow for one file observes the previous mutation.
const mutationTails = new Map<string, Promise<void>>();

export async function withStoreMutationLock<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = mutationTails.get(key) ?? Promise.resolve();
  const waitForPrevious = previous.catch(() => undefined);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const tail = waitForPrevious.then(() => gate);
  mutationTails.set(key, tail);
  await waitForPrevious;
  try {
    return await operation();
  } finally {
    release();
    if (mutationTails.get(key) === tail) mutationTails.delete(key);
  }
}
