import type { IpcRenderer } from "electron";
import type { CanvasWorkspaceApi } from "../../renderer/src/types";
import { subscribe } from "./ipc";

type ExternalUpdate = Parameters<Parameters<CanvasWorkspaceApi["store"]["onExternalUpdate"]>[0]>[0];
type MigrationProgress = Parameters<Parameters<CanvasWorkspaceApi["store"]["onMigrationProgress"]>[0]>[0];

export const createStoreApi = (ipcRenderer: IpcRenderer): CanvasWorkspaceApi["store"] => ({
  save: (id, data, authoritative) =>
    ipcRenderer.invoke("canvas:save", { id, data, authoritative }),

  load: (id) =>
    ipcRenderer.invoke("canvas:load", { id }),

  list: () => ipcRenderer.invoke("canvas:list"),

  delete: (id) =>
    ipcRenderer.invoke("canvas:delete", { id }),

  getDir: (id) =>
    ipcRenderer.invoke("canvas:getDir", { id }),

  exportWorkspace: (id, name) =>
    ipcRenderer.invoke("canvas:exportWorkspace", { id, name }),

  importWorkspace: () =>
    ipcRenderer.invoke("canvas:importWorkspace"),

  listPollutedWorkspaces: () =>
    ipcRenderer.invoke("canvas:listPollutedWorkspaces"),

  watchWorkspace: (workspaceId) =>
    ipcRenderer.invoke("canvas:watchWorkspace", { workspaceId }),

  onExternalUpdate: (callback) =>
    subscribe<ExternalUpdate>(ipcRenderer, "canvas:external-update", callback),

  onMigrationProgress: (callback) =>
    subscribe<MigrationProgress>(ipcRenderer, "canvas:migration-progress", callback)
});
