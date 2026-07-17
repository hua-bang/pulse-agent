/**
 * In-app Google sign-in window.
 *
 * Google's OAuth "secure browsers" policy blocks account sign-in in embedded
 * <webview>s (disallowed_useragent), but a top-level BrowserWindow is treated
 * as a full browser and is allowed. This opens Google's sign-in page in such a
 * window using the DEFAULT session — the same session the app's partition-less
 * <webview>s use — so the login cookie is shared: after the user signs in and
 * closes the window, reloading a webview shows the logged-in state.
 *
 * IPC:
 *   - auth:open-google-login → { ok } (resolves when the login window closes)
 */

import { BrowserWindow, ipcMain } from 'electron';

const GOOGLE_SIGNIN_URL = 'https://accounts.google.com/';

/**
 * Open the Google sign-in window and resolve once it is closed. Deliberately a
 * plain top-level BrowserWindow (no parent, no partition → default session, no
 * preload) so Google sees a normal browser and the session is shared with the
 * webviews.
 */
export function openGoogleLoginWindow(): Promise<void> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 480,
      height: 660,
      title: 'Sign in to Google',
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    win.once('closed', () => resolve());
    void win.loadURL(GOOGLE_SIGNIN_URL);
  });
}

export function setupAuthIpc(): void {
  ipcMain.handle('auth:open-google-login', async () => {
    try {
      await openGoogleLoginWindow();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
