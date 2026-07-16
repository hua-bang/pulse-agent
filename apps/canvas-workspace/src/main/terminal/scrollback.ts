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

const SCROLLBACK_MAX_CHARS = 100_000;
const scrollback = new Map<string, string>();

function appendScrollback(id: string, data: string): void {
  const next = (scrollback.get(id) ?? '') + data;
  scrollback.set(
    id,
    next.length > SCROLLBACK_MAX_CHARS ? next.slice(next.length - SCROLLBACK_MAX_CHARS) : next,
  );
}

// Strip ANSI/VT control sequences so the captured buffer reads as plain text.
// Control bytes are referenced by code point (ESC = 27) via the RegExp
// constructor so no literal control bytes live in the source.
const ESC = '\\x1b';
const ANSI_CSI = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g'); // colors, cursor moves
const ANSI_OSC = new RegExp(`${ESC}\\][^\\x07${ESC}]*(?:\\x07|${ESC}\\\\)`, 'g'); // title, links
const ANSI_ESC = new RegExp(`${ESC}[@-Z\\\\-_]`, 'g'); // single-char escapes
const CTRL_CHARS = new RegExp('[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f]', 'g'); // other control chars

function stripAnsi(raw: string): string {
  return raw
    .replace(ANSI_CSI, '')
    .replace(ANSI_OSC, '')
    .replace(ANSI_ESC, '')
    .replace(/\r(?!\n)/g, '') // bare CRs that just re-draw the line
    .replace(CTRL_CHARS, '');
}

/**
 * Return the plain-text tail of a session's output, or an error when no such
 * session is known. Used by the tab-reading agent tool for terminal tabs.
 */
export function getSessionScrollback(
  id: string,
  maxChars = SCROLLBACK_MAX_CHARS,
): { ok: boolean; text?: string; error?: string } {
  const raw = scrollback.get(id);
  if (raw === undefined) {
    return { ok: false, error: `No terminal session found for id: ${id}` };
  }
  const cleaned = stripAnsi(raw).replace(/\n{3,}/g, '\n\n').trimEnd();
  const text = cleaned.length > maxChars ? cleaned.slice(cleaned.length - maxChars) : cleaned;
  return { ok: true, text };
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
