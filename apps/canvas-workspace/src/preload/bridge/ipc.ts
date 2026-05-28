import type { IpcRenderer, IpcRendererEvent } from "electron";

export type Unsubscribe = () => void;

export const subscribe = <Payload>(
  ipcRenderer: IpcRenderer,
  channel: string,
  callback: (payload: Payload) => void
): Unsubscribe => {
  const handler = (_event: IpcRendererEvent, payload: Payload) => {
    callback(payload);
  };
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
};
