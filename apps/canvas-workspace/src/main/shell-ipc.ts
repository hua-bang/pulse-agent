/**
 * Shell IPC bridge.
 *
 * Iframe / webview canvas nodes embed third-party pages whose `<a target="_blank">`
 * links and `window.open()` calls need to escape the embed and land in the
 * user's real browser. The renderer captures those gestures (via the webview's
 * `new-window` event and the main window's `setWindowOpenHandler`) and routes
 * the URL here so we can call `shell.openExternal` from main.
 */
import { ipcMain, shell } from 'electron';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

function isSafeExternalUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return ALLOWED_PROTOCOLS.has(u.protocol);
  } catch {
    return false;
  }
}

export function setupShellIpc(): void {
  ipcMain.handle('shell:openExternal', async (_event, payload: { url?: string }) => {
    const url = payload?.url;
    if (!url || !isSafeExternalUrl(url)) {
      return { ok: false, error: 'unsupported url' };
    }
    try {
      await shell.openExternal(url);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

export { isSafeExternalUrl };
