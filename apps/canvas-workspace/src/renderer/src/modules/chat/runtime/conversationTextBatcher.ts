const MAX_BATCH_CHARS = 512;
const MIN_BATCH_WAIT_MS = 32;
const MAX_BATCH_WAIT_MS = 200;
// Each flush re-renders the whole message, so a flush costs more as the reply
// grows. Past this size the batch window widens with the text already
// flushed, which keeps the render work per second about flat.
const CHARS_PER_WAIT_MS = 64;

const batchWaitMs = (flushedChars: number): number => Math.min(
  MAX_BATCH_WAIT_MS,
  Math.max(MIN_BATCH_WAIT_MS, flushedChars / CHARS_PER_WAIT_MS),
);

export function createConversationTextBatcher(flush: (delta: string) => void) {
  let buffered = '';
  let flushedChars = 0;
  let timer: number | undefined;

  const flushNow = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
    if (!buffered) return;
    const delta = buffered;
    buffered = '';
    flushedChars += delta.length;
    flush(delta);
  };

  return {
    push(delta: string) {
      buffered += delta;
      const waitMs = batchWaitMs(flushedChars);
      // A long reply waits for its window even past the size cap.
      if (buffered.length >= MAX_BATCH_CHARS && waitMs === MIN_BATCH_WAIT_MS) {
        flushNow();
        return;
      }
      if (timer === undefined) timer = window.setTimeout(flushNow, waitMs);
    },
    flush: flushNow,
  };
}
