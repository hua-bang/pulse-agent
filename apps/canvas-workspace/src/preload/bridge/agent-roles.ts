import type { IpcRenderer } from "electron";
import type { AgentRolesApi } from "../../shared/agent-roles";

export const createAgentRolesApi = (ipcRenderer: IpcRenderer): AgentRolesApi => ({
  list: () => ipcRenderer.invoke("agent-roles:list"),

  save: (input) => ipcRenderer.invoke("agent-roles:save", { input }),

  remove: (id) => ipcRenderer.invoke("agent-roles:delete", { id }),

  getSettings: () => ipcRenderer.invoke("agent-roles:settings-get"),

  saveSettings: (settings) => ipcRenderer.invoke("agent-roles:settings-save", { settings }),

  externalProbe: (family) => ipcRenderer.invoke("agent-roles:external-probe", { family })
});
