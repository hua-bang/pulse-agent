import type { IpcRenderer } from "electron";
import type { AgentContextTabRef } from "../../shared/agent-chat";
import { subscribe, type Unsubscribe } from "./ipc";

export const createDockApi = (ipcRenderer: IpcRenderer) => ({
  publishTabs: (workspaceId: string, tabs: AgentContextTabRef[]) =>
    ipcRenderer.send("dock:publish-tabs", { workspaceId, tabs }),

  onActivateTab: (callback: (payload: { tabId: string }) => void): Unsubscribe =>
    subscribe(ipcRenderer, "dock:activate-tab", callback),

  onOpenTab: (callback: (payload: { url: string; tabId?: string }) => void): Unsubscribe =>
    subscribe(ipcRenderer, "dock:open-tab", callback),
});
