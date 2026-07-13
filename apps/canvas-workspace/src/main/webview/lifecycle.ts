/**
 * Chrome-style page freezing for url-webview nodes — L2 of the webview
 * lifecycle ladder (L1 frame-rate throttle → L2 freeze → L3 discard, not
 * yet implemented).
 *
 * Mechanism: the same one Chrome applies to background tabs — the DevTools
 * protocol's `Page.setWebLifecycleState`. A frozen page's task queues are
 * suspended (JS, timers, rAF, and network polling all stop) while the guest
 * process and its memory stay intact, so unfreezing is instantaneous and
 * never reloads. The page receives the standard Page Lifecycle
 * `freeze`/`resume` events, so any page that behaves in a background Chrome
 * tab behaves the same here (WebSockets drop on freeze and pages reconnect
 * on resume, exactly as they do in Chrome).
 *
 * Exemptions mirror Chrome's: audible pages and pages with DevTools open
 * are never frozen. The renderer treats a skip as "retry later while still
 * offscreen". The debugger pipe is held only while frozen and released on
 * resume so DevTools can attach normally afterwards.
 */

export type WebviewLifecycleState = 'active' | 'frozen';

export interface SetLifecycleResult {
  ok: boolean;
  state?: WebviewLifecycleState;
  /** Chrome-style exemption that prevented freezing. */
  skipped?: 'destroyed' | 'audible' | 'devtools';
  error?: string;
}

/** The webContents surface this controller needs (test-injectable). */
export interface FreezableWebContents {
  isDestroyed: () => boolean;
  isCurrentlyAudible: () => boolean;
  isDevToolsOpened: () => boolean;
  debugger: {
    isAttached: () => boolean;
    attach: (protocolVersion?: string) => void;
    detach: () => void;
    sendCommand: (command: string, params?: unknown) => Promise<unknown>;
  };
}

export const setWebviewLifecycle = async (
  wc: FreezableWebContents | null,
  state: WebviewLifecycleState,
): Promise<SetLifecycleResult> => {
  if (!wc || wc.isDestroyed()) return { ok: false, skipped: 'destroyed' };

  if (state === 'frozen') {
    if (wc.isCurrentlyAudible()) return { ok: false, skipped: 'audible' };
    if (wc.isDevToolsOpened()) return { ok: false, skipped: 'devtools' };
    try {
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
      await wc.debugger.sendCommand('Page.setWebLifecycleState', { state: 'frozen' });
      frozenSince.set(wc, Date.now());
      return { ok: true, state: 'frozen' };
    } catch (err) {
      // attach() throws when another debugger (DevTools) already owns the
      // pipe; sendCommand can fail on navigation races. Both are retryable.
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // state === 'active'
  frozenSince.delete(wc);
  if (!wc.debugger.isAttached()) {
    // Never frozen, or the debugger was detached externally (which itself
    // unfreezes the page) — nothing to do.
    return { ok: true, state: 'active' };
  }
  try {
    await wc.debugger.sendCommand('Page.setWebLifecycleState', { state: 'active' });
    return { ok: true, state: 'active' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    // Release the pipe outside the frozen window so DevTools can attach.
    try {
      wc.debugger.detach();
    } catch {
      // already detached — fine
    }
  }
};

/**
 * When each webContents entered the frozen state — the L3 discard monitor
 * uses this both as the candidate filter (only frozen pages are ever
 * discarded) and as the LRU ordering (oldest frozen goes first). WeakMap so
 * destroyed guests never linger.
 */
const frozenSince = new WeakMap<FreezableWebContents, number>();

export const getFrozenSince = (wc: FreezableWebContents): number | undefined =>
  frozenSince.get(wc);
