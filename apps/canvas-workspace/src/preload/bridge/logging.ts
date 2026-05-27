import type { IpcRenderer } from "electron";

export type SendLog = (level: string, message: string, details?: string) => void;

export const createLogSender = (ipcRenderer: IpcRenderer): SendLog => {
  return (level, message, details) => {
    ipcRenderer.send("app:log", { level, message, details });
  };
};

export const installRendererErrorLogging = (sendLog: SendLog): void => {
  window.addEventListener("error", (event) => {
    sendLog("renderer", "window error", String(event.error ?? event.message));
  });

  window.addEventListener("unhandledrejection", (event) => {
    sendLog("renderer", "unhandledrejection", String(event.reason));
  });
};
