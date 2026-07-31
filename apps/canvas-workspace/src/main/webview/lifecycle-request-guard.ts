/** Last-intent-wins guard plus a per-guest transition lane. Snapshot work can
 * be canceled, but once a CDP transition starts its two commands must finish
 * before a newer intent touches the same debugger pipe. */
const latestByGuest = new Map<number, symbol>();
const transitionTailByGuest = new Map<number, Promise<void>>();

export interface LifecycleRequestLease {
  isCurrent: () => boolean;
  finish: () => void;
}

export function beginLifecycleRequest(webContentsId: number): LifecycleRequestLease {
  const token = Symbol(String(webContentsId));
  latestByGuest.set(webContentsId, token);
  const isCurrent = () => latestByGuest.get(webContentsId) === token;
  return {
    isCurrent,
    finish: () => {
      if (isCurrent()) latestByGuest.delete(webContentsId);
    },
  };
}

/** Runs debugger transitions in arrival order for one WebContents. The task's
 * failure never poisons the lane, and an idle lane is removed immediately. */
export async function serializeLifecycleTransition<T>(
  webContentsId: number,
  task: () => Promise<T>,
): Promise<T> {
  const previous = transitionTailByGuest.get(webContentsId) ?? Promise.resolve();
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => gate);
  transitionTailByGuest.set(webContentsId, tail);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (transitionTailByGuest.get(webContentsId) === tail) {
      transitionTailByGuest.delete(webContentsId);
    }
  }
}
