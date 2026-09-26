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
import { registerPtyObserver, type PtySessionInfo } from './pty-manager';
import { appendScrollback, dropRawScrollback } from './session-output';

export { getSessionScrollback, readSessionOutput } from './session-output';

let installed = false;

/**
 * Register the scrollback-capturing PTY observer (idempotent). Its IPC lives
 * in `scrollback-ipc.ts`, loaded lazily by bootstrap.
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
}
