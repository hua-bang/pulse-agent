import type { IpcRenderer } from "electron";
import type { ArtifactsApi } from "../../renderer/src/types";
import { subscribe } from "./ipc";

export const createArtifactsApi = (ipcRenderer: IpcRenderer): ArtifactsApi => ({
  list: (workspaceId) =>
    ipcRenderer.invoke("artifact:list", { workspaceId }),

  get: (workspaceId, artifactId) =>
    ipcRenderer.invoke("artifact:get", { workspaceId, artifactId }),

  create: (workspaceId, input) =>
    ipcRenderer.invoke("artifact:create", { workspaceId, input }),

  addVersion: (workspaceId, artifactId, input) =>
    ipcRenderer.invoke("artifact:add-version", { workspaceId, artifactId, input }),

  update: (workspaceId, artifactId, patch) =>
    ipcRenderer.invoke("artifact:update", { workspaceId, artifactId, patch }),

  delete: (workspaceId, artifactId) =>
    ipcRenderer.invoke("artifact:delete", { workspaceId, artifactId }),

  pinToCanvas: (workspaceId, artifactId, placement) =>
    ipcRenderer.invoke("artifact:pin-to-canvas", { workspaceId, artifactId, placement }),

  onChange: (callback) =>
    subscribe(ipcRenderer, "artifact:change", callback)
});
