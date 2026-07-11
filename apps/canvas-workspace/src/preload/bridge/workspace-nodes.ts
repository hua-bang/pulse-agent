import type { IpcRenderer } from "electron";
import type { CanvasWorkspaceApi } from "../../renderer/src/types";
import { subscribe } from "./ipc";

export const createWorkspaceNodesApi = (
  ipcRenderer: IpcRenderer
): CanvasWorkspaceApi["workspaceNodes"] => ({
  list: (workspaceId) =>
    ipcRenderer.invoke("workspace-node:list", { workspaceId }),

  read: (workspaceId, nodeId) =>
    ipcRenderer.invoke("workspace-node:read", { workspaceId, nodeId }),

  tags: () =>
    ipcRenderer.invoke("workspace-node:tags"),

  upsertTag: (tag) =>
    ipcRenderer.invoke("workspace-node:upsert-tag", { tag }),

  updateTags: (workspaceId, nodeId, tags) =>
    ipcRenderer.invoke("workspace-node:update-tags", { workspaceId, nodeId, tags }),

  update: (workspaceId, nodeId, patch) =>
    ipcRenderer.invoke("workspace-node:update", { workspaceId, nodeId, patch }),

  applyProposal: (proposal) =>
    ipcRenderer.invoke("workspace-node:apply-proposal", { proposal }),

  onChange: (callback) =>
    subscribe(ipcRenderer, "workspace-node:change", callback)
});
