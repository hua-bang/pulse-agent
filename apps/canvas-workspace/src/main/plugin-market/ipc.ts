import { ipcMain } from 'electron';
import type { PluginMarketSource } from '../../shared/plugin-market';
import { getPluginMarketService } from './service';

export function setupPluginMarketIpc(): void {
  const market = getPluginMarketService();

  ipcMain.handle('plugin-market:list', async () => {
    try {
      return { ok: true, snapshot: await market.list() };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('plugin-market:refresh', async () => {
    try {
      return { ok: true, snapshot: await market.refresh() };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('plugin-market:install', (_event, payload: { listingId?: string }) => (
    market.install(payload.listingId ?? '')
  ));
  ipcMain.handle('plugin-market:uninstall', (_event, payload: { listingId?: string }) => (
    market.uninstall(payload.listingId ?? '')
  ));
  ipcMain.handle('plugin-market:connect-mcp', (_event, payload: { listingId?: string }) => (
    market.connectMcp(payload.listingId ?? '')
  ));
  ipcMain.handle(
    'plugin-market:set-native-enabled',
    (_event, payload: { listingId?: string; enabled?: boolean }) => (
      market.setNativeEnabled(payload.listingId ?? '', payload.enabled === true)
    ),
  );
  ipcMain.handle('plugin-market:choose-directory', () => market.chooseDirectory());
  ipcMain.handle('plugin-market:add-git', (_event, payload: { source?: PluginMarketSource }) => (
    market.addGit(payload.source ?? { kind: 'git' })
  ));
}
