/**
 * Quit handshake. `before-quit` closes storage before any window closes, so a
 * renderer's own unload save would arrive at a closed store. Each window is
 * asked to save first (`canvas:flush-before-quit`, main → renderer) and
 * answers with `canvas:flushed`; a window that does not answer in time is
 * not waited for.
 */
import { randomUUID } from 'node:crypto';
import { BrowserWindow, ipcMain } from 'electron';

const FLUSH_TIMEOUT_MS = 1_500;

export async function flushRenderersBeforeQuit(timeoutMs = FLUSH_TIMEOUT_MS): Promise<void> {
  const windows = BrowserWindow.getAllWindows().filter(window => !window.isDestroyed());
  await Promise.all(windows.map(window => new Promise<void>((resolve) => {
    const requestId = randomUUID();
    const finish = () => {
      clearTimeout(timer);
      ipcMain.removeListener('canvas:flushed', onFlushed);
      resolve();
    };
    const onFlushed = (_event: unknown, answeredId: unknown) => {
      if (answeredId === requestId) finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    ipcMain.on('canvas:flushed', onFlushed);
    try { window.webContents.send('canvas:flush-before-quit', requestId); }
    catch { finish(); }
  })));
}
