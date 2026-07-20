import type { IpcRenderer } from "electron";
import type { MemoryReportApi } from "../../shared/memory-report";

export const createMemoryReportApi = (ipcRenderer: IpcRenderer): MemoryReportApi => ({
  runNow: () => ipcRenderer.invoke("memory-report:run-now"),
});
