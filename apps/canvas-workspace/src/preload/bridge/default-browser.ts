import type { IpcRenderer } from "electron";
import type { DefaultBrowserApi } from "../../shared/default-browser";

export const createDefaultBrowserApi = (
  ipcRenderer: IpcRenderer,
): DefaultBrowserApi => ({
  consumePending: () => ipcRenderer.invoke("default-browser:consume-pending"),
});
