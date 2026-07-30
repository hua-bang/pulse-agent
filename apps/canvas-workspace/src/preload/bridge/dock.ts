import type { IpcRenderer } from "electron";
import type { AgentContextTabRef } from "../../shared/agent-chat";
import type { DockBrowserCommand } from "../../shared/dock-shortcuts";
import { subscribe, type Unsubscribe } from "./ipc";

export const createDockApi = (ipcRenderer: IpcRenderer) => ({
  publishTabs: (workspaceId: string, tabs: AgentContextTabRef[]) =>
    ipcRenderer.send("dock:publish-tabs", { workspaceId, tabs }),

  onActivateTab: (callback: (payload: { workspaceId: string; tabId: string }) => void): Unsubscribe =>
    subscribe(ipcRenderer, "dock:activate-tab", callback),

  onOpenTab: (callback: (payload: { url: string; tabId?: string }) => void): Unsubscribe =>
    subscribe(ipcRenderer, "dock:open-tab", callback),

  onOpenArtifact: (
    callback: (payload: { workspaceId: string; artifactId: string }) => void,
  ): Unsubscribe => subscribe(ipcRenderer, "dock:open-artifact", callback),

  onShortcut: (
    callback: (payload: { command: DockBrowserCommand }) => void,
  ): Unsubscribe => subscribe(ipcRenderer, "dock:shortcut", callback),
});
