import type { IpcRenderer } from "electron";
import type { MemoryReportApi } from "../../shared/memory-report";
import { subscribe } from "./ipc";

export const createMemoryReportApi = (ipcRenderer: IpcRenderer): MemoryReportApi => ({
  runNow: () => ipcRenderer.invoke("memory-report:run-now"),

  onProgress: (callback) => subscribe(ipcRenderer, "memory-report:progress", callback),
});
