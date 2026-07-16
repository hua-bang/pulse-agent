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

  read: (filePath) =>
    ipcRenderer.invoke("file:read", { filePath }),

  write: (filePath, content) =>
    ipcRenderer.invoke("file:write", { filePath, content }),

  listDir: (dirPath, maxDepth) =>
    ipcRenderer.invoke("file:listDir", { dirPath, maxDepth }),

  openInVSCode: (filePath) =>
    ipcRenderer.invoke("file:openInVSCode", { filePath }),

  openDialog: () => ipcRenderer.invoke("file:openDialog"),

  saveAsDialog: (defaultName, content) =>
    ipcRenderer.invoke("file:saveAsDialog", { defaultName, content }),

  saveImage: (workspaceId, data, ext) =>
    ipcRenderer.invoke("file:saveImage", { workspaceId, data, ext }),

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
