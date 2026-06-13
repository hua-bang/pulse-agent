import type { IpcRenderer } from 'electron';
import type { AppInfoApi } from '../../renderer/src/types';

export const createAppInfoApi = (ipcRenderer: IpcRenderer): AppInfoApi => ({
  getInfo: () => ipcRenderer.invoke('app:getInfo'),
  checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates'),
});
