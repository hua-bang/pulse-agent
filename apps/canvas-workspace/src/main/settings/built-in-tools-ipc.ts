import { ipcMain } from 'electron';
import {
  clearBuiltInToolCredential,
  getBuiltInToolsConfigStatus,
  setBuiltInToolCredential,
  type BuiltInToolCredentialId,
} from './built-in-tools-config';

export function setupBuiltInToolsConfigIpc(): void {
  ipcMain.handle('built-in-tools:status', async () => {
    try {
      return { ok: true, status: await getBuiltInToolsConfigStatus() };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle(
    'built-in-tools:set-credential',
    async (_event, payload: { id: BuiltInToolCredentialId; apiKey?: string; baseUrl?: string }) => {
      try {
        return { ok: true, status: await setBuiltInToolCredential(payload) };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    'built-in-tools:clear-credential',
    async (_event, payload: { id: string }) => {
      try {
        return { ok: true, status: await clearBuiltInToolCredential(payload.id) };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );
}
