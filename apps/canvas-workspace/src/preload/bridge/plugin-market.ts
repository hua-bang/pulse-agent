import type { IpcRenderer } from 'electron';
import type { PluginMarketApi } from '../../shared/plugin-market';

export const createPluginMarketApi = (ipcRenderer: IpcRenderer): PluginMarketApi => ({
  list: () => ipcRenderer.invoke('plugin-market:list'),
  refresh: () => ipcRenderer.invoke('plugin-market:refresh'),
  install: (listingId) => ipcRenderer.invoke('plugin-market:install', { listingId }),
  uninstall: (listingId) => ipcRenderer.invoke('plugin-market:uninstall', { listingId }),
  connectMcp: (listingId) => ipcRenderer.invoke('plugin-market:connect-mcp', { listingId }),
  setNativeEnabled: (listingId, enabled) => (
    ipcRenderer.invoke('plugin-market:set-native-enabled', { listingId, enabled })
  ),
  chooseDirectory: () => ipcRenderer.invoke('plugin-market:choose-directory'),
  addGit: (source) => ipcRenderer.invoke('plugin-market:add-git', { source }),
});
