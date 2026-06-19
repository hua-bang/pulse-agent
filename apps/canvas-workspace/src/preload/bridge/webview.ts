import type { IpcRenderer } from "electron";
import type {
  IframeApi,
  LinkApi,
  LlmApi,
  ShellApi,
  WebApi
} from "../../renderer/src/types";
import { subscribe } from "./ipc";

export const createIframeApi = (ipcRenderer: IpcRenderer): IframeApi => ({
  registerWebview: (workspaceId, nodeId, webContentsId) =>
    ipcRenderer.invoke("iframe:register-webview", { workspaceId, nodeId, webContentsId }),

  unregisterWebview: (workspaceId, nodeId) =>
    ipcRenderer.invoke("iframe:unregister-webview", { workspaceId, nodeId }),

  setFrameRate: (workspaceId, nodeId, frameRate) =>
    ipcRenderer.invoke("iframe:set-frame-rate", { workspaceId, nodeId, frameRate }),

  pickDomElement: (workspaceId, nodeId) =>
    ipcRenderer.invoke("iframe:pick-dom-element", { workspaceId, nodeId }),

  cancelDomElementPick: (workspaceId, nodeId) =>
    ipcRenderer.invoke("iframe:cancel-dom-element-pick", { workspaceId, nodeId })
});

export const createShellApi = (ipcRenderer: IpcRenderer): ShellApi => ({
  openExternal: (url) =>
    ipcRenderer.invoke("shell:openExternal", { url })
});

export const createLinkApi = (ipcRenderer: IpcRenderer): LinkApi => ({
  onOpen: (callback) => subscribe<{ url: string }>(ipcRenderer, "link:open", callback)
});

export const createLlmApi = (ipcRenderer: IpcRenderer): LlmApi => ({
  generateHTML: (prompt) =>
    ipcRenderer.invoke("llm:generate-html", { prompt }),

  streamHTML: (prompt) =>
    ipcRenderer.invoke("llm:stream-html", { prompt }),

  onHTMLDelta: (requestId, callback) =>
    subscribe<string>(ipcRenderer, `llm:html-delta:${requestId}`, callback),

  onHTMLComplete: (requestId, callback) =>
    subscribe(ipcRenderer, `llm:html-complete:${requestId}`, callback)
});

export const createWebApi = (ipcRenderer: IpcRenderer): WebApi => ({
  read: (payload) => ipcRenderer.invoke("web:read", payload)
});
