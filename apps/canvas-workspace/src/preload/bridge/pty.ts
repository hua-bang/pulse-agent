import type { IpcRenderer } from "electron";
import type { CanvasWorkspaceApi } from "../../renderer/src/types";
import { subscribe } from "./ipc";

export const createPtyApi = (ipcRenderer: IpcRenderer): CanvasWorkspaceApi["pty"] => ({
  spawn: (id, cols, rows, cwd, workspaceId, env) =>
    ipcRenderer.invoke("pty:spawn", { id, cols, rows, cwd, workspaceId, env }),

  write: (id, data) =>
    ipcRenderer.send("pty:write", { id, data }),

  resize: (id, cols, rows) =>
    ipcRenderer.send("pty:resize", { id, cols, rows }),

  kill: (id, leaseId) => ipcRenderer.send("pty:kill", { id, leaseId }),

  getCwd: (id) => ipcRenderer.invoke("pty:getCwd", { id }),

  checkCommand: (command) => ipcRenderer.invoke("pty:checkCommand", { command }),

  onData: (id, callback) => subscribe<string>(ipcRenderer, `pty:data:${id}`, callback),

  onExit: (id, callback) => subscribe<number>(ipcRenderer, `pty:exit:${id}`, callback)
});
