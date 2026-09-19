import type { IpcRenderer } from "electron";
import type { FileApi } from "../../renderer/src/types";
import { subscribe } from "./ipc";

type FileChangedPayload = {
  filePath: string;
  content: string;
};

export const createFileApi = (ipcRenderer: IpcRenderer): FileApi => ({
  createNote: (workspaceId, name) =>
    ipcRenderer.invoke("file:createNote", { workspaceId, name }),

  savePreview: (request) => ipcRenderer.invoke('file:save-preview', request),

  preview: (filePath) => ipcRenderer.invoke('file:preview', { filePath }),

  read: (filePath) =>
    ipcRenderer.invoke("file:read", { filePath }),

  write: (filePath, content, expectedVersion) =>
    ipcRenderer.invoke("file:write", {
      filePath,
      content,
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    }),

  listDir: (dirPath, maxDepth, includeHidden) =>
    ipcRenderer.invoke("file:listDir", { dirPath, maxDepth, includeHidden }),

  createEntry: (request) => ipcRenderer.invoke('file:create-entry', request),
  renameEntry: (request) => ipcRenderer.invoke('file:rename-entry', request),
  trashEntry: (request) => ipcRenderer.invoke('file:trash-entry', request),

  openInVSCode: (filePath) =>
    ipcRenderer.invoke("file:openInVSCode", { filePath }),

  openPath: (filePath) =>
    ipcRenderer.invoke("file:openPath", { filePath }),

  openDialog: () => ipcRenderer.invoke("file:openDialog"),

  saveAsDialog: (defaultName, content) =>
    ipcRenderer.invoke("file:saveAsDialog", { defaultName, content }),

  saveImage: (workspaceId, data, ext) =>
    ipcRenderer.invoke("file:saveImage", { workspaceId, data, ext }),

  deleteSavedImage: (workspaceId, filePath) =>
    ipcRenderer.invoke("file:delete-saved-image", { workspaceId, filePath }),

  getImagePreview: (filePath, maxDimension) =>
    ipcRenderer.invoke('file:getImagePreview', { filePath, maxDimension }),

  exportImage: (defaultName, data, ext) =>
    ipcRenderer.invoke("file:exportImage", { defaultName, data, ext }),

  copyImage: (filePath) =>
    ipcRenderer.invoke("file:copyImage", { filePath }),

  onChanged: (callback) =>
    subscribe<FileChangedPayload>(ipcRenderer, "canvas:file-changed", (payload) => {
      callback(payload.filePath, payload.content);
    })
});
