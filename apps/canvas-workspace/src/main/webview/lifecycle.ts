/**
 * Chrome-style page freezing for url-webview nodes — L2 of the webview
 * lifecycle ladder (L1 frame-rate throttle → L2 freeze → L3 discard).
 *
 * Mechanism, two layers over one held debugger pipe:
 *
 * 1. `Page.setWebLifecycleState 'frozen'` — the same command Chrome applies
 *    to background tabs. When it engages, task queues are suspended (JS,
 *    timers, rAF, network polling) and the page receives the standard Page
 *    Lifecycle `freeze`/`resume` events, so WebSockets drop and reconnect
 *    exactly as in a background Chrome tab. BUT Chromium silently ignores
 *    it for pages it considers visible, and real-Electron CI verification
 *    showed guests report `document.visibilityState === 'visible'`
 *    regardless of the host element's CSS — guest visibility tracks the
 *    embedder window, not the element. So this layer alone is not reliable
 *    for canvas webviews.
 * 2. `Emulation.setScriptExecutionDisabled true` — the guarantee layer.
 *    Scheduled timers and handlers simply skip execution while disabled and
 *    pick back up on re-enable; DOM, JS heap, and in-page state stay
 *    intact, and resume never reloads. This works regardless of what
 *    visibility the guest believes it has.
 *
 * Both are set on freeze and reversed on resume; either engaging is enough
 * to stop guest JS + network. Memory stays resident in both layers — that
 * is L3 (discard-monitor.ts)'s job to reclaim.
 *
 * Exemptions mirror Chrome's: audible pages and pages with DevTools open
 * are never frozen. The renderer treats a skip as "retry later while still
 * offscreen". The debugger pipe is held only while frozen and released on
 * resume so DevTools can attach normally afterwards (detaching also clears
 * the emulation override — belt and braces with the explicit re-enable).
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
      // Lifecycle freeze first: if it engages, the page gets its `freeze`
      // event while scripts still run (WebSocket cleanup handlers etc.),
      // THEN script execution is disabled as the visibility-independent
      // guarantee (see header).
      await wc.debugger.sendCommand('Page.setWebLifecycleState', { state: 'frozen' });
      await wc.debugger.sendCommand('Emulation.setScriptExecutionDisabled', { value: true });
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
    // Re-enable scripts before unfreezing so the page's `resume` event
    // handlers can actually execute when the lifecycle state flips.
    await wc.debugger.sendCommand('Emulation.setScriptExecutionDisabled', { value: false });
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
