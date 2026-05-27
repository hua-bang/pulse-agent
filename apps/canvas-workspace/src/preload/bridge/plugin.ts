import type { IpcRenderer } from "electron";
import type { PluginBridge } from "../../plugins/types";

export const createPluginBridge = (ipcRenderer: IpcRenderer): PluginBridge => ({
  invoke: (pluginId, channel, ...args) =>
    ipcRenderer.invoke(`plugin:${pluginId}:${channel}`, ...args)
});
