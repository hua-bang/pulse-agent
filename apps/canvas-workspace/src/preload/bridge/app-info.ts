import type { IpcRenderer } from 'electron';
import type { AppInfoApi } from '../../shared/api/app-info';
import { APP_MENU_COMMAND_CHANNEL, type AppMenuCommand } from '../../shared/app-info';
import { subscribe } from './ipc';

export const createAppInfoApi = (ipcRenderer: IpcRenderer): AppInfoApi => ({
  getInfo: () => ipcRenderer.invoke('app:getInfo'),
  checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates'),
  onMenuCommand: (callback) =>
    subscribe<AppMenuCommand>(ipcRenderer, APP_MENU_COMMAND_CHANNEL, callback),
});
