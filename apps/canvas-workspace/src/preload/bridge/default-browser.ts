import type { IpcRenderer } from "electron";
import type { DefaultBrowserApi } from "../../shared/default-browser";

export const createDefaultBrowserApi = (
  ipcRenderer: IpcRenderer,
): DefaultBrowserApi => ({
  status: () => ipcRenderer.invoke("default-browser:status"),

  set: (enabled) =>
    ipcRenderer.invoke("default-browser:set", { enabled }),

  consumePending: () => ipcRenderer.invoke("default-browser:consume-pending"),
});
