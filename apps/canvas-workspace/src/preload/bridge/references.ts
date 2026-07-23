import type { IpcRenderer } from "electron";
import type { ReferencesApi } from "../../shared/references";

export const createReferencesApi = (ipcRenderer: IpcRenderer): ReferencesApi => ({
  list: (workspaceId) =>
    ipcRenderer.invoke("reference:list", { workspaceId }),

  save: (workspaceId, references) =>
    ipcRenderer.invoke("reference:save", { workspaceId, references }),
});
