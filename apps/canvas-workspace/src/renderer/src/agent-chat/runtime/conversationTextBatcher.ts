const MAX_BATCH_CHARS = 512;
const MAX_BATCH_WAIT_MS = 32;

export function createConversationTextBatcher(flush: (delta: string) => void) {
  let buffered = '';
  let timer: number | undefined;

  const flushNow = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
    if (!buffered) return;
    const delta = buffered;
    buffered = '';
    flush(delta);
  };

  return {
    push(delta: string) {
      buffered += delta;
      if (buffered.length >= MAX_BATCH_CHARS) {
        flushNow();
        return;
      }
      if (timer === undefined) timer = window.setTimeout(flushNow, MAX_BATCH_WAIT_MS);
    },
    flush: flushNow,
  };
}
