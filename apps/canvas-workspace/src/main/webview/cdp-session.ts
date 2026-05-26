/**
 * Single-slot CDP session helper for an Electron `<webview>` WebContents.
 *
 * Electron's `webContents.debugger` exposes the Chrome DevTools Protocol —
 * but a webContents can only have **one** debugger attached at a time, so
 * concurrent callers (a screenshot read overlapping with a click action,
 * for example) will collide on `debugger.attach()` and one of them will
 * throw "Debugger is already attached to this target".
 *
 * {@link withCdp} serialises CDP usage per-webContents via a promise
 * chain stored in a WeakMap. Each call:
 *   1. Queues behind any in-flight CDP work on the same webContents.
 *   2. Attaches the debugger (no-op if something already attached it
 *      out-of-band, e.g. user opening DevTools).
 *   3. Runs the caller's body with a typed `send(method, params)` helper.
 *   4. Detaches if we were the attacher, always — even on rejection.
 *
 * Reading and writing primitives both go through this. Tests pass a
 * stub `CdpHost` so they don't need a real webContents.
 */

const VERSION = '1.3';

export interface CdpDebuggerHandle {
  isAttached(): boolean;
  attach(protocolVersion?: string): void;
  detach(): void;
  sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

export interface CdpHost {
  debugger: CdpDebuggerHandle;
}

export type CdpSender = <T = unknown>(
  method: string,
  params?: Record<string, unknown>,
) => Promise<T>;

// Per-webContents lock. WeakMap so destroyed webContents drop their
// entry automatically — no manual cleanup needed.
const locks = new WeakMap<object, Promise<unknown>>();

/**
 * Run `fn` with exclusive CDP access to `host`. The mutex guarantees:
 *   - No two `withCdp` calls run their bodies concurrently on the same host.
 *   - The debugger is detached when our body finishes, even if it threw.
 *   - The next queued caller proceeds after we resolve the chain entry,
 *     regardless of whether our body resolved or rejected.
 */
export async function withCdp<T>(
  host: CdpHost,
  fn: (send: CdpSender) => Promise<T>,
): Promise<T> {
  // IMPORTANT: read prev + set new BEFORE any await, otherwise two
  // simultaneous callers can both read the same `prev` and run in parallel.
  const prev = locks.get(host) ?? Promise.resolve();
  let releaseChain!: () => void;
  const chainEntry = new Promise<void>((resolve) => {
    releaseChain = resolve;
  });
  locks.set(host, chainEntry);

  // Wait our turn.
  try {
    await prev;
  } catch {
    // Predecessor rejected — that's not our problem. The chain still
    // advances; our body still runs.
  }

  let attachedByUs = false;
  try {
    if (!host.debugger.isAttached()) {
      host.debugger.attach(VERSION);
      attachedByUs = true;
    }
    const send: CdpSender = <R>(method: string, params?: Record<string, unknown>) =>
      host.debugger.sendCommand(method, params) as Promise<R>;
    return await fn(send);
  } finally {
    if (attachedByUs) {
      try {
        host.debugger.detach();
      } catch {
        // Detach is best-effort — if the page navigated away mid-flight,
        // the debugger may already be gone. Swallow so we don't shadow
        // the real error.
      }
    }
    releaseChain();
  }
}
