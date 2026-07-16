import type { IpcRenderer } from "electron";
import type { AgentContextTabRef } from "../../shared/agent-chat";

export const createDockApi = (ipcRenderer: IpcRenderer) => ({
  publishTabs: (workspaceId: string, tabs: AgentContextTabRef[]) =>
    ipcRenderer.send("dock:publish-tabs", { workspaceId, tabs }),
});
