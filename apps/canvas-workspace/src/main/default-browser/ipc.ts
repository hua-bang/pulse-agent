/**
 * IPC for the default-browser feature.
 *
 * Channels (all `ipcMain.handle`):
 *   - default-browser:consume-pending → { urls: string[] }  (drain cold-start URLs)
 *
 * OS registration is driven from the "Set as default browser" experimental
 * flag (see main/settings/experimental-ipc.ts → register.ts), not from here.
 * Inbound URL capture (single-instance lock, open-url, second-instance, argv)
 * is wired separately and earlier via `setupDeepLinkEarly` in ./deep-link.
 */

import { ipcMain } from 'electron';
import { consumePendingLinks } from './deep-link';

export function setupDefaultBrowserIpc(): void {
  ipcMain.handle('default-browser:consume-pending', () => ({
    urls: consumePendingLinks(),
  }));
}
