/**
 * IPC for the default-browser feature.
 *
 * Channels (all `ipcMain.handle`):
 *   - default-browser:status          → DefaultBrowserStatus
 *   - default-browser:set             ({ enabled }) → DefaultBrowserStatus
 *   - default-browser:consume-pending → { urls: string[] }  (drain cold-start URLs)
 *
 * Inbound URL capture (single-instance lock, open-url, second-instance, argv)
 * is wired separately and earlier via `setupDeepLinkEarly` in ./deep-link.
 */

import { ipcMain } from 'electron';
import type { WriteLog } from '../app/logging';
import { readDefaultBrowserStatus, setDefaultBrowser } from './register';
import { consumePendingLinks } from './deep-link';

export function setupDefaultBrowserIpc(writeLog?: WriteLog): void {
  ipcMain.handle('default-browser:status', () => readDefaultBrowserStatus());

  ipcMain.handle(
    'default-browser:set',
    (_event, payload: { enabled?: boolean }) => {
      const enabled = !!payload?.enabled;
      const status = setDefaultBrowser(enabled);
      void writeLog?.(
        'default-browser',
        enabled ? 'register requested' : 'unregister requested',
        `isDefault=${status.isDefault}`,
      );
      return status;
    },
  );

  ipcMain.handle('default-browser:consume-pending', () => ({
    urls: consumePendingLinks(),
  }));
}
