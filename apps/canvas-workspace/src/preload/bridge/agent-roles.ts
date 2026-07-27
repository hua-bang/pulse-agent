import type { IpcRenderer } from "electron";
import type { AgentRolesApi } from "../../shared/agent-roles";

export const createAgentRolesApi = (ipcRenderer: IpcRenderer): AgentRolesApi => ({
  list: () => ipcRenderer.invoke("agent-roles:list"),

  save: (input) => ipcRenderer.invoke("agent-roles:save", { input }),

  remove: (id) => ipcRenderer.invoke("agent-roles:delete", { id })
});
