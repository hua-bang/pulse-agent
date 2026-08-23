export function createConversationTextBatcher(flush: (delta: string) => void) {
  let buffered = '';
  let frame: number | undefined;

  const flushNow = () => {
    frame = undefined;
    if (!buffered) return;
    const delta = buffered;
    buffered = '';
    flush(delta);
  };

  return {
    push(delta: string) {
      buffered += delta;
      if (frame === undefined) frame = window.requestAnimationFrame(flushNow);
    },
    flush: flushNow,
  };
}
