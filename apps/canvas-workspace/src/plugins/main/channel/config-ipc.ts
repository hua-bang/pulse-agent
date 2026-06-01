/**
 * IPC for channel credentials (Settings → Experimental → Chat channels).
 *
 * Registered unconditionally at app startup — independent of whether the
 * channel plugin itself activated — so the user can configure credentials
 * even when the plugin is currently inactive (it only activates once
 * configured + the experimental flag is on).
 *
 * Changes take effect on the next full app launch: the channel plugin's
 * `enabledWhen` and `applyChannelConfigToEnv()` both run at main-process
 * startup, so `relaunch` is offered to apply them.
 */

import { app, ipcMain } from 'electron';
import {
  clearFeishuConfig,
  getChannelConfigStatus,
  setFeishuConfig,
  type SetFeishuConfigInput,
} from './config';

export function setupChannelConfigIpc(): void {
  ipcMain.handle('channel-config:status', async () => {
    try {
      return { ok: true, status: await getChannelConfigStatus() };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('channel-config:set-feishu', async (_event, payload: SetFeishuConfigInput) => {
    try {
      await setFeishuConfig(payload ?? {});
      return { ok: true, status: await getChannelConfigStatus() };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('channel-config:clear-feishu', async () => {
    try {
      await clearFeishuConfig();
      return { ok: true, status: await getChannelConfigStatus() };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Full relaunch so the channel plugin re-evaluates enabledWhen and
  // re-applies config to the environment (main-process restart required —
  // a renderer reload alone does not re-run plugin activation).
  ipcMain.handle('channel-config:relaunch', () => {
    app.relaunch();
    app.exit(0);
    return { ok: true };
  });
}
