/**
 * IPC for the persisted UI locale.
 *
 * - `locale:read-sync` — synchronous read for the sandboxed preload, which
 *   can't touch the filesystem itself. Mirrors the `experimental:read-sync`
 *   pattern.
 * - `locale:get` / `locale:set` — async accessors for the renderer.
 * - `locale:changed` — broadcast to every other window after a successful
 *   `set`, so multi-window setups stay in sync without a reload.
 */

import { BrowserWindow, ipcMain } from 'electron';
import { isSupportedLocale, SUPPORTED_LOCALES } from '../shared/locales';
import { readLocale, readLocaleSync, writeLocale } from './locale-store';

export function setupLocaleIpc(): void {
  ipcMain.on('locale:read-sync', (event) => {
    event.returnValue = readLocaleSync();
  });

  ipcMain.handle('locale:get', async () => {
    try {
      const locale = await readLocale();
      return { ok: true, locale, supported: SUPPORTED_LOCALES };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('locale:set', async (event, payload: { locale: string }) => {
    try {
      if (!payload || !isSupportedLocale(payload.locale)) {
        return { ok: false, error: 'Unsupported locale' };
      }
      await writeLocale(payload.locale);
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.isDestroyed()) continue;
        if (win.webContents.id === event.sender.id) continue;
        win.webContents.send('locale:changed', { locale: payload.locale });
      }
      return { ok: true, locale: payload.locale };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
