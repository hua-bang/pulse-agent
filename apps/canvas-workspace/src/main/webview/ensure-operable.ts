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
 *   - `read`  tools only need a live WebContents → use whatever is registered;
 *     only activate when nothing is registered yet.
 *   - `operate` tools (clicks, fills, screenshots) need a *painted* surface →
 *     always activate the workspace (removes `display: none` + shows the window
 *     inactively, without stealing focus) and give the compositor a beat to
 *     produce a frame.
 *
 * The pure logic here takes its registry lookup and activation as injected
 * functions so it can be unit-tested without Electron.
 */

const DEFAULT_WAIT_MS = 8_000;
const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_PAINT_SETTLE_MS = 350;

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
 * Resolve the node's live WebContents, activating its workspace first when the
 * tool needs a painted surface (or when nothing is registered yet). Returns the
 * WebContents, or null if it never became available within `waitMs`.
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

  const existing = opts.lookup();
  // A read on an already-registered node works even when it's display:none, so
  // don't steal the active-workspace slot just to read text.
  if (existing && opts.mode === 'read') return existing;

  // operate mode always activates (to get a paint surface); read mode only
  // reaches here when the node isn't registered yet.
  if (opts.mode === 'operate' || !existing) {
    try {
      await opts.activate();
    } catch {
      /* fall through — it may already be usable, or the wait below will fail cleanly */
    }
  }

  let wc = opts.lookup();
  const deadline = now() + waitMs;
  while (!wc && now() < deadline) {
    await delay(pollMs);
    wc = opts.lookup();
  }
  if (!wc) return null;

  if (opts.mode === 'operate') await delay(settleMs);
  return wc;
}

function autoActivateDisabled(): boolean {
  const v = process.env.CANVAS_WEBVIEW_AUTO_ACTIVATE?.trim().toLowerCase();
  return v === '0' || v === 'false' || v === 'off';
}
