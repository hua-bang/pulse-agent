import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron';
import {
  addCanvasPluginDirectory,
  getCanvasPluginsStatus,
  importCanvasPluginsConfigJson,
  removeCanvasPluginDirectory,
} from './canvas-plugins-config';

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
      return {
        ok: true,
        status: await addCanvasPluginDirectory(payload.dir ?? ''),
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
      return {
        ok: true,
        selectedDir: result.filePaths[0],
        status: await addCanvasPluginDirectory(result.filePaths[0]),
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('canvas-plugins:remove-directory', async (_event, payload: { dir?: string }) => {
    try {
      return {
        ok: true,
        status: await removeCanvasPluginDirectory(payload.dir ?? ''),
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('canvas-plugins:import-json', async (_event, payload: { json?: string }) => {
    try {
      const result = await importCanvasPluginsConfigJson(payload.json ?? '');
      return {
        ok: true,
        status: result.status,
        entries: result.entries,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
