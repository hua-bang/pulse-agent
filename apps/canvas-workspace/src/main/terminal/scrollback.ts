/**
 * Rolling PTY scrollback capture.
 *
 * The renderer's xterm instance owns the visible buffer; main keeps a capped
 * tail per session so the Canvas Agent can read what a terminal is showing
 * (via `dock_read_tab`, node reads, and team activity) without a renderer
 * round trip. Implemented as a PTY observer so it stays out of the
 * pty-manager hot path — call `setupScrollbackCapture()` once at startup.
 *
 * Two sources, in order of preference:
 *  - a rendered snapshot the owning renderer publishes (`pty:snapshot`). Full
 *    screen TUIs such as coding agents redraw constantly, so their raw stream
 *    is mostly repeated frames; xterm's rendered buffer is the readable text.
 *    Coding Agent output lives only here — it is no longer saved on the canvas.
 *  - the raw PTY stream, ANSI-stripped, for sessions without a snapshot.
 *
 * Snapshots outlive their process so a finished agent's last output stays
 * readable; the oldest are evicted beyond MAX_RETAINED_SNAPSHOTS.
 */
import { ipcMain } from 'electron';
import { registerPtyObserver, type PtySessionInfo } from './pty-manager';
import {
  appendScrollback,
  dropRawScrollback,
  getSessionScrollback,
  publishSessionSnapshot,
} from './session-output';

export { getSessionScrollback, readSessionOutput } from './session-output';

let installed = false;

/**
 * Register the scrollback-capturing PTY observer and its IPC (idempotent).
 * Channels: `pty:snapshot` (send, renderer → main), `pty:getScrollback` (invoke).
 */
export function setupScrollbackCapture(): void {
  if (installed) return;
  installed = true;
  registerPtyObserver({
    onData: (info: PtySessionInfo, data: string) => appendScrollback(info.id, data),
    onExit: (info: PtySessionInfo) => {
      dropRawScrollback(info.id);
    },
  });
  ipcMain.on('pty:snapshot', (_event, payload: { id?: unknown; text?: unknown }) => {
    if (typeof payload?.id !== 'string' || !payload.id || typeof payload.text !== 'string') return;
    publishSessionSnapshot(payload.id, payload.text);
  });
  ipcMain.handle('pty:getScrollback', (_event, payload: { id?: unknown; maxChars?: unknown }) => {
    if (typeof payload?.id !== 'string' || !payload.id) return { ok: false, error: 'Expected a session id' };
    const maxChars = typeof payload.maxChars === 'number' && payload.maxChars > 0 ? payload.maxChars : undefined;
    return getSessionScrollback(payload.id, maxChars);
  });
}
