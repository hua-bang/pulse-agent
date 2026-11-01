/**
 * Quit handshake. `before-quit` closes storage before any window closes, so a
 * renderer's own unload save would arrive at a closed store. Each window is
 * asked to save first (`canvas:flush-before-quit`, main → renderer) and
 * answers with `canvas:flushed`. A failed save or a timeout is not a
 * successful quit: the marker `unsaved-quit.json` is left in userData, and
 * the next launch tells the user those edits may be missing.
 */
import { randomUUID } from 'node:crypto';
import { BrowserWindow, ipcMain } from 'electron';
import { recordUnsavedQuit, type UnsavedQuitReason } from './unsaved-quit';

/** Slow disks need longer than a round trip. 1.5s dropped in-flight saves. */
export const FLUSH_BEFORE_QUIT_TIMEOUT_MS = 15_000;

interface FlushWindowResult {
  ok: boolean;
  reason?: UnsavedQuitReason;
}

export async function flushRenderersBeforeQuit(timeoutMs = FLUSH_BEFORE_QUIT_TIMEOUT_MS): Promise<void> {
  const windows = BrowserWindow.getAllWindows().filter(window => !window.isDestroyed());
  const results = await Promise.all(windows.map(window => new Promise<FlushWindowResult>((resolve) => {
    const requestId = randomUUID();
    let settled = false;
    const finish = (result: FlushWindowResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ipcMain.removeListener('canvas:flushed', onFlushed);
      resolve(result);
    };
    const onFlushed = (_event: unknown, answeredId: unknown, ok: unknown) => {
      if (answeredId !== requestId) return;
      finish(ok === false ? { ok: false, reason: 'failed' } : { ok: true });
    };
    const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), timeoutMs);
    ipcMain.on('canvas:flushed', onFlushed);
    try { window.webContents.send('canvas:flush-before-quit', requestId); }
    catch { finish({ ok: false, reason: 'failed' }); }
  })));
  if (!results.some(result => !result.ok)) return;
  const reason = results.some(result => result.reason === 'timeout') ? 'timeout' : 'failed';
  await recordUnsavedQuit(reason).catch(error => {
    console.warn('[canvas] could not record unsaved quit', error);
  });
}
