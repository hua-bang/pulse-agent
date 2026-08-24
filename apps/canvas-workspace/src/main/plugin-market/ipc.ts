import { ipcMain } from 'electron';
import type { PluginMarketSource } from '../../shared/plugin-market';

const getMarket = async () => (await import('./service')).getPluginMarketService();

export function setupPluginMarketIpc(): void {
  ipcMain.handle('plugin-market:list', async () => {
    try {
      const market = await getMarket();
      return { ok: true, snapshot: await market.list() };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('plugin-market:refresh', async () => {
    try {
      const market = await getMarket();
      return { ok: true, snapshot: await market.refresh() };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('plugin-market:install', async (_event, payload: { listingId?: string }) => (
    (await getMarket()).install(payload.listingId ?? '')
  ));
  ipcMain.handle('plugin-market:uninstall', async (_event, payload: { listingId?: string }) => (
    (await getMarket()).uninstall(payload.listingId ?? '')
  ));
  ipcMain.handle('plugin-market:connect-mcp', async (_event, payload: { listingId?: string }) => (
    (await getMarket()).connectMcp(payload.listingId ?? '')
  ));
  ipcMain.handle(
    'plugin-market:set-native-enabled',
    async (_event, payload: { listingId?: string; enabled?: boolean }) => (
      (await getMarket()).setNativeEnabled(payload.listingId ?? '', payload.enabled === true)
    ),
  );
  ipcMain.handle('plugin-market:choose-directory', async () => (await getMarket()).chooseDirectory());
  ipcMain.handle('plugin-market:add-git', async (_event, payload: { source?: PluginMarketSource }) => (
    (await getMarket()).addGit(payload.source ?? { kind: 'git' })
  ));
}
