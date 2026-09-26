/**
 * In-memory output of PTY sessions, kept by main and never persisted.
 * Electron-free so readers (context builder, tools, tests) can import it;
 * `scrollback.ts` feeds it from the PTY observer and IPC.
 */

const SCROLLBACK_MAX_CHARS = 100_000;
const MAX_RETAINED_SNAPSHOTS = 64;
const scrollback = new Map<string, string>();
const snapshots = new Map<string, string>();

export function appendScrollback(id: string, data: string): void {
  const next = (scrollback.get(id) ?? '') + data;
  scrollback.set(
    id,
    next.length > SCROLLBACK_MAX_CHARS ? next.slice(next.length - SCROLLBACK_MAX_CHARS) : next,
  );
}

/** Record the rendered text of a session; the newest snapshots are retained. */
export function publishSessionSnapshot(id: string, text: string): void {
  snapshots.delete(id);
  snapshots.set(id, text.length > SCROLLBACK_MAX_CHARS ? text.slice(-SCROLLBACK_MAX_CHARS) : text);
  while (snapshots.size > MAX_RETAINED_SNAPSHOTS) {
    const oldest = snapshots.keys().next().value;
    if (oldest === undefined) break;
    snapshots.delete(oldest);
  }
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
 * session is known. Used by the tab-reading agent tool and node reads.
 */
export function getSessionScrollback(
  id: string,
  maxChars = SCROLLBACK_MAX_CHARS,
): { ok: boolean; text?: string; error?: string } {
  const snapshot = snapshots.get(id);
  const raw = scrollback.get(id);
  if (snapshot === undefined && raw === undefined) {
    return { ok: false, error: `No terminal session found for id: ${id}` };
  }
  const cleaned = (snapshot ?? stripAnsi(raw ?? '')).replace(/\n{3,}/g, '\n\n').trimEnd();
  const text = cleaned.length > maxChars ? cleaned.slice(cleaned.length - maxChars) : cleaned;
  return { ok: true, text };
}

/** Live output for a node's session, falling back to what the node saved. */
export function readSessionOutput(sessionId: unknown, saved: unknown): string {
  const live = typeof sessionId === 'string' && sessionId ? getSessionScrollback(sessionId) : null;
  if (live?.ok) return live.text ?? '';
  return typeof saved === 'string' ? saved : '';
}

/** Forget the raw stream of an exited process; its rendered snapshot stays. */
export function dropRawScrollback(id: string): void {
  scrollback.delete(id);
}
