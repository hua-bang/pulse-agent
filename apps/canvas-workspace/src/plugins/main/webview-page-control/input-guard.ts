import { withCdp, type CdpHost, type CdpSender } from '../../../main/webview/cdp-session';

/** Optional guards for code-driven inputs; existing page_* callers retain their behavior. */
export interface CdpInputGuard {
  signal?: AbortSignal;
  timeoutMs?: number;
  beforeInput?: (method?: string, params?: Record<string, unknown>) => Promise<void>;
  /** Called immediately before dispatch, so failures after this point are never blindly retried. */
  onInput?: (method: string, params?: Record<string, unknown>) => void;
}

/** Release the queue even when a dispatched command never acknowledges cancellation. */
export function abortable<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve().then(() => {
      signal.throwIfAborted();
      return operation();
    }).then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}

export async function checkInput(guard: CdpInputGuard, method?: string, params?: Record<string, unknown>): Promise<void> {
  guard.signal?.throwIfAborted();
  await guard.beforeInput?.(method, params);
  guard.signal?.throwIfAborted();
}

export async function withGuardedCdp<T>(host: CdpHost, guard: CdpInputGuard, run: (send: CdpSender) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const signal = controller.signal;
  const cancel = () => controller.abort(guard.signal?.reason ?? new Error('Input cancelled'));
  guard.signal?.addEventListener('abort', cancel, { once: true });
  if (guard.signal?.aborted) cancel();
  const timeoutMs = guard.timeoutMs ?? 5_000;
  const timer = setTimeout(() => controller.abort(new Error(`CDP input timed out after ${timeoutMs}ms`)), timeoutMs);
  const guardedOptions = { ...guard, signal };
  // Use the original host for the shared CDP mutex, including while queued behind another caller.
  try {
    return await abortable(signal, () => withCdp(host, async send => {
      await abortable(signal, () => checkInput(guardedOptions));
      let mouseDown = false;
      let keyDown = false;
      const guarded: CdpSender = async <R>(method: string, params?: Record<string, unknown>) => {
        const mouseRelease = method === 'Input.dispatchMouseEvent' && params?.type === 'mouseReleased';
        const keyRelease = method === 'Input.dispatchKeyEvent' && params?.type === 'keyUp';
        // Complete the same validated input pair even if its down event navigated
        // or changed the control. Re-validating that old snapshot would turn a
        // successful click/Enter into a false failure. No new down event is allowed.
        if ((mouseRelease && mouseDown) || (keyRelease && keyDown)) {
          signal.throwIfAborted();
        } else {
          await abortable(signal, () => checkInput(guardedOptions, method, params));
        }
        guard.onInput?.(method, params);
        const result = await abortable(signal, () => send<R>(method, params));
        if (method === 'Input.dispatchMouseEvent') mouseDown = params?.type === 'mousePressed';
        if (method === 'Input.dispatchKeyEvent') keyDown = params?.type === 'keyDown' || params?.type === 'rawKeyDown';
        return result;
      };
      return abortable(signal, () => run(guarded));
    }));
  } finally {
    clearTimeout(timer);
    guard.signal?.removeEventListener('abort', cancel);
    if (!signal.aborted) controller.abort(new Error('Input scope closed'));
  }
}
