/**
 * IPC for the in-memory session output (see session-output.ts). Loaded
 * lazily from bootstrap to keep the handlers out of the main bundle.
 * Channels: `pty:snapshot` (send, renderer → main), `pty:getScrollback` (invoke).
 */
import { ipcMain } from 'electron';
import { getSessionScrollback, publishSessionSnapshot } from './session-output';

export function setupScrollbackIpc(): void {
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
