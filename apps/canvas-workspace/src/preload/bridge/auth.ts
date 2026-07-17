import type { IpcRenderer } from "electron";
import type { AuthApi } from "../../shared/auth";

export const createAuthApi = (ipcRenderer: IpcRenderer): AuthApi => ({
  openGoogleLogin: () => ipcRenderer.invoke("auth:open-google-login"),
});
