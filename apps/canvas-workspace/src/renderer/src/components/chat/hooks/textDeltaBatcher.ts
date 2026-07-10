export interface TextDeltaBatcher {
  push: (delta: string) => void;
  flush: () => void;
  cancel: () => void;
}

interface TextDeltaBatcherOptions {
  schedule: (callback: () => void) => number;
  cancelScheduled: (handle: number) => void;
  onFlush: (delta: string) => void;
}

/** Coalesce token-sized IPC deltas into one React update per visual time slice. */
export const createTextDeltaBatcher = ({
  schedule,
  cancelScheduled,
  onFlush,
}: TextDeltaBatcherOptions): TextDeltaBatcher => {
  let pending = '';
  let scheduledHandle: number | null = null;

  const flush = () => {
    if (scheduledHandle !== null) {
      cancelScheduled(scheduledHandle);
      scheduledHandle = null;
    }
    if (!pending) return;
    const delta = pending;
    pending = '';
    onFlush(delta);
  };

  return {
    push: (delta) => {
      if (!delta) return;
      pending += delta;
      if (scheduledHandle === null) {
        scheduledHandle = schedule(() => {
          scheduledHandle = null;
          if (!pending) return;
          const deltaForFrame = pending;
          pending = '';
          onFlush(deltaForFrame);
        });
      }
    },
    flush,
    cancel: () => {
      if (scheduledHandle !== null) cancelScheduled(scheduledHandle);
      scheduledHandle = null;
      pending = '';
    },
  };
};
