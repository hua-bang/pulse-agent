import { ipcMain } from 'electron';
import {
  getPromptProfile,
  resetPromptProfile,
  savePromptProfile,
  type PromptProfile,
} from './canvas-agent/prompt-profile';

export function setupCanvasPromptIpc(): void {
  ipcMain.handle('canvas-prompt-profile:get', async () => {
    try {
      return { ok: true, profile: await getPromptProfile() };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle(
    'canvas-prompt-profile:save',
    async (_event, payload: { profile: Partial<PromptProfile> }) => {
      try {
        return { ok: true, profile: await savePromptProfile(payload.profile ?? {}) };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle('canvas-prompt-profile:reset', async () => {
    try {
      return { ok: true, profile: await resetPromptProfile() };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });
}
