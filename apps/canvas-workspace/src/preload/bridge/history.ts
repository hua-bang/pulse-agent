import type { IpcRenderer } from "electron";
import type { BrowsingHistoryApi } from "../../shared/browsing-history";

export const createHistoryApi = (ipcRenderer: IpcRenderer): BrowsingHistoryApi => ({
  record: (input) => ipcRenderer.send("history:record", input),
  search: (query, limit) => ipcRenderer.invoke("history:search", { query, limit })
});
