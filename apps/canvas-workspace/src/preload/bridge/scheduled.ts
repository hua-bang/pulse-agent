import type { IpcRenderer } from 'electron';
import type { ScheduledApi } from '../../shared/scheduled';
import { subscribe } from './ipc';

export const createScheduledApi = (ipcRenderer: IpcRenderer): ScheduledApi => ({
  list: () => ipcRenderer.invoke('scheduled:list'),
  create: (input) => ipcRenderer.invoke('scheduled:create', input),
  update: (taskId, patch) => ipcRenderer.invoke('scheduled:update', { taskId, patch }),
  remove: (taskId) => ipcRenderer.invoke('scheduled:remove', taskId),
  runNow: (taskId) => ipcRenderer.invoke('scheduled:run-now', taskId),
  progress: () => ipcRenderer.invoke('scheduled:progress'),
  onChanged: (callback) => subscribe(ipcRenderer, 'scheduled:changed', callback),
  onRunFinished: (callback) => subscribe(ipcRenderer, 'scheduled:run-finished', callback),
  onRunProgress: (callback) => subscribe(ipcRenderer, 'scheduled:run-progress', callback),
});
