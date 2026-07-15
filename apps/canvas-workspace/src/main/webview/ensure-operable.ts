/**
 * Make an iframe node's webview *operable* before a webview tool touches it.
 *
 * Two facts drive this:
 *   1. When a workspace isn't the active one, the canvas keeps it mounted but
 *      `display: none` (see Workbench). Its guest WebContents stays alive and
 *      registered, so DOM/a11y reads (executeJavaScript / CDP) still work — but
 *      there is no compositing surface, so screenshots come back blank and
 *      CDP input (clicks) can't hit-test reliably.
 *   2. If the workspace was never opened in this window (or the window is
 *      hidden/minimized), the node has no registered WebContents at all.
 *
 * So:
 *   - all tools activate and select the target node without stealing OS focus.
 *     Selection is the renderer's operation lease: a Chrome-style residency
 *     manager must not discard the guest while a tool is using it.
 *   - `operate` tools (clicks, fills, screenshots) additionally wait for a
 *     painted surface before dispatching input.
 *
 * The pure logic here takes its registry lookup and activation as injected
 * functions so it can be unit-tested without Electron.
 */

const DEFAULT_WAIT_MS = 8_000;
const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_PAINT_SETTLE_MS = 350;
const DEFAULT_PROTECTION_SETTLE_MS = 100;

const settleWithin = <T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> => (
  new Promise((resolve) => {
    let settled = false;
    const finish = (value: T | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), Math.max(0, timeoutMs));
    timer.unref?.();
    promise.then(
      value => finish(value),
      () => finish(null),
    );
  })
);

export type OperableMode = 'read' | 'operate';

export interface EnsureOperableOptions<T> {
  /** Current registry lookup for the node's live WebContents (null if none). */
  lookup: () => T | null;
  /**
   * Bring the workspace on-screen and make it the active one (un-hides its
   * `display: none` container and `showInactive()`s the window — no focus steal).
   */
  activate: () => Promise<{ ok: boolean; error?: string }>;
  mode: OperableMode;
  /** Max time to wait for a freshly-activated node to register. Default 8s. */
  waitMs?: number;
  pollIntervalMs?: number;
  /** Pause after activation so the compositor produces a frame. Default 350ms. */
  paintSettleMs?: number;
  // Injectable for tests.
  delay?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Resolve the node's live WebContents after activating/selecting it. Returns
 * the WebContents, or null if it never became available within `waitMs`.
 */
export async function ensureOperable<T>(opts: EnsureOperableOptions<T>): Promise<T | null> {
  const delay = opts.delay ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const waitMs = opts.waitMs ?? DEFAULT_WAIT_MS;
  const pollMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const settleMs = opts.paintSettleMs ?? DEFAULT_PAINT_SETTLE_MS;

  // Escape hatch: behave exactly as before (no auto-activation), for users who
  // don't want the agent reclaiming the active-workspace slot from a channel.
  if (autoActivateDisabled()) return opts.lookup();

  // Activation is part of the same bounded wait budget. Window creation/load
  // can fail without emitting a successful load event; a never-settling
  // activation must not hang Agent reads, page control, or the DOM picker.
  const deadline = now() + waitMs;
  const activation = await settleWithin(
    Promise.resolve().then(opts.activate),
    Math.max(0, deadline - now()),
  );
  const activated = activation?.ok === true;

  let wc = opts.lookup();
  while (!wc && now() < deadline) {
    await delay(pollMs);
    wc = opts.lookup();
  }
  if (!wc) return null;

  if (activated) {
    const requestedSettleMs = opts.mode === 'operate' ? settleMs : DEFAULT_PROTECTION_SETTLE_MS;
    const remainingMs = Math.max(0, deadline - now());
    if (remainingMs > 0) await delay(Math.min(requestedSettleMs, remainingMs));

    // Selection/wake may replace a sleeping guest with a new WebContents
    // generation during compositor settle. Never hand a caller the stale
    // object captured before that transition.
    wc = opts.lookup();
    while (!wc && now() < deadline) {
      await delay(Math.min(pollMs, Math.max(0, deadline - now())));
      wc = opts.lookup();
    }
  }
  return wc;
}

function autoActivateDisabled(): boolean {
  const v = process.env.CANVAS_WEBVIEW_AUTO_ACTIVATE?.trim().toLowerCase();
  return v === '0' || v === 'false' || v === 'off';
}
