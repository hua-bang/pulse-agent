/**
 * Rolling PTY scrollback capture.
 *
 * The renderer's xterm instance owns the visible buffer; main keeps a capped
 * tail per session so the Canvas Agent can read what a terminal tab is showing
 * (via `canvas_read_tab`) without a renderer round trip. Implemented as a PTY
 * observer so it stays out of the pty-manager hot path — call
 * `setupScrollbackCapture()` once at startup.
 */
import { registerPtyObserver, type PtySessionInfo } from './pty-manager';
import { normalizeScrollback } from './scrollback-text';

const SCROLLBACK_MAX_CHARS = 100_000;
const scrollback = new Map<string, string>();

function appendScrollback(id: string, data: string): void {
  const next = (scrollback.get(id) ?? '') + data;
  scrollback.set(
    id,
    next.length > SCROLLBACK_MAX_CHARS ? next.slice(next.length - SCROLLBACK_MAX_CHARS) : next,
  );
}

/**
 * Return the plain-text tail of a session's output, or an error when no such
 * session is known. Used by the tab-reading agent tool for terminal tabs.
 *
 * Cleaning rules live in `scrollback-text.ts` and are shared with the
 * persisted-node read path — keep them there, not here.
 */
export function getSessionScrollback(
  id: string,
  maxChars = SCROLLBACK_MAX_CHARS,
): { ok: boolean; text?: string; error?: string } {
  const raw = scrollback.get(id);
  if (raw === undefined) {
    return { ok: false, error: `No terminal session found for id: ${id}` };
  }
  return { ok: true, text: normalizeScrollback(raw, { maxChars }) };
}

let installed = false;

/** Register the scrollback-capturing PTY observer (idempotent). */
export function setupScrollbackCapture(): void {
  if (installed) return;
  installed = true;
  registerPtyObserver({
    onData: (info: PtySessionInfo, data: string) => appendScrollback(info.id, data),
    onExit: (info: PtySessionInfo) => {
      scrollback.delete(info.id);
    },
  });
}
