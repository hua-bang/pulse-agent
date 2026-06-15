import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron';
import {
  addCanvasPluginDirectory,
  getCanvasPluginsStatus,
  importCanvasPluginsConfigJson,
  removeCanvasPluginDirectory,
  setCanvasPluginConfigValue,
} from './canvas-plugins-config';
import { getCanvasAgentService } from '../agent/ipc';
import { reloadConfiguredExternalMainPlugins } from '../../plugins/main';

async function refreshRuntimePluginsAndAgents(): Promise<void> {
  await reloadConfiguredExternalMainPlugins();
  await getCanvasAgentService().reloadMcp();
}

export function setupCanvasPluginsConfigIpc(): void {
  ipcMain.handle('canvas-plugins:list', async () => {
    try {
      return { ok: true, status: await getCanvasPluginsStatus() };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('canvas-plugins:add-directory', async (_event, payload: { dir?: string }) => {
    try {
      const status = await addCanvasPluginDirectory(payload.dir ?? '');
      await refreshRuntimePluginsAndAgents();
      return {
        ok: true,
        status,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('canvas-plugins:choose-directory', async () => {
    try {
      const win = BrowserWindow.getFocusedWindow();
      const options: OpenDialogOptions = {
        title: 'Select Canvas Plugin Directory',
        properties: ['openDirectory'],
      };
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options);
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false, canceled: true };
      }
      const status = await addCanvasPluginDirectory(result.filePaths[0]);
      await refreshRuntimePluginsAndAgents();
      return {
        ok: true,
        selectedDir: result.filePaths[0],
        status,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('canvas-plugins:remove-directory', async (_event, payload: { dir?: string }) => {
    try {
      const status = await removeCanvasPluginDirectory(payload.dir ?? '');
      await refreshRuntimePluginsAndAgents();
      return {
        ok: true,
        status,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('canvas-plugins:import-json', async (_event, payload: { json?: string }) => {
    try {
      const result = await importCanvasPluginsConfigJson(payload.json ?? '');
      await refreshRuntimePluginsAndAgents();
      return {
        ok: true,
        status: result.status,
        entries: result.entries,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(
    'canvas-plugins:set-config',
    async (_event, payload: { pluginId?: string; key?: string; value?: string }) => {
      try {
        const status = await setCanvasPluginConfigValue(
          payload.pluginId ?? '',
          payload.key ?? '',
          payload.value ?? '',
        );
        await refreshRuntimePluginsAndAgents();
        return {
          ok: true,
          status,
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );
}
