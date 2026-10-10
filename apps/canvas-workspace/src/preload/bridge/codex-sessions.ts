import type { IpcRenderer } from "electron";
import type { CodexSessionsApi } from "../../shared/api/codex-sessions";

export const createCodexSessionsApi = (ipcRenderer: IpcRenderer): CodexSessionsApi => ({
  list: (payload) => ipcRenderer.invoke("codex-sessions:list", payload),
  findByMarker: (payload) => ipcRenderer.invoke("codex-sessions:find-by-marker", payload),
});
