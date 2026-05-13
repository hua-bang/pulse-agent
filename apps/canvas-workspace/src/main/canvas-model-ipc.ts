import { ipcMain } from 'electron';
import {
  getCanvasModelStatus,
  removeCanvasModelOption,
  resetCanvasModelConfig,
  saveCanvasModelConfig,
  setCanvasCurrentModel,
  upsertCanvasModelOption,
  type CanvasModelConfig,
  type CanvasModelOption,
} from './canvas-agent/model-config';

export function setupCanvasModelIpc(): void {
  ipcMain.handle('canvas-model:status', async () => {
    try {
      return { ok: true, status: await getCanvasModelStatus() };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle('canvas-model:save-config', async (_event, payload: { config: CanvasModelConfig }) => {
    try {
      return { ok: true, status: await saveCanvasModelConfig(payload.config) };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle('canvas-model:upsert-option', async (_event, payload: { option: CanvasModelOption; setCurrent?: boolean }) => {
    try {
      return { ok: true, status: await upsertCanvasModelOption(payload.option, payload.setCurrent === true) };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle('canvas-model:set-current', async (_event, payload: { name: string }) => {
    try {
      return { ok: true, status: await setCanvasCurrentModel(payload.name) };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle('canvas-model:remove-option', async (_event, payload: { name: string }) => {
    try {
      return { ok: true, status: await removeCanvasModelOption(payload.name) };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle('canvas-model:reset', async () => {
    try {
      return { ok: true, status: await resetCanvasModelConfig() };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });
}
