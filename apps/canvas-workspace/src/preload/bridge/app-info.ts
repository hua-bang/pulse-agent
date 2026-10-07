import type { IpcRenderer } from 'electron';
import type { AppInfoApi } from '../../shared/api/app-info';

export const createAppInfoApi = (ipcRenderer: IpcRenderer): AppInfoApi => ({
  getInfo: () => ipcRenderer.invoke('app:getInfo'),
  checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates'),
});
