import type { IpcRenderer } from "electron";
import type { AgentContextTabRef } from "../../shared/agent-chat";
import type { DockShortcutRequest } from "../../shared/dock-shortcuts";
import type {
  DockActivateTabRequest,
  DockActivateTabResult,
} from "../../shared/dock-tab-commands";
import { subscribe, type Unsubscribe } from "./ipc";

export const createDockApi = (ipcRenderer: IpcRenderer) => ({
  publishTabs: (workspaceId: string, tabs: AgentContextTabRef[]) =>
    ipcRenderer.send("dock:publish-tabs", { workspaceId, tabs }),

  onActivateTab: (callback: (payload: DockActivateTabRequest) => void): Unsubscribe =>
    subscribe(ipcRenderer, "dock:activate-tab", callback),

  reportTabActivation: (result: DockActivateTabResult) =>
    ipcRenderer.send("dock:tab-activation-result", result),

  onOpenTab: (callback: (payload: { url: string; tabId?: string }) => void): Unsubscribe =>
    subscribe(ipcRenderer, "dock:open-tab", callback),

  onOpenArtifact: (
    callback: (payload: { workspaceId: string; artifactId: string }) => void,
  ): Unsubscribe => subscribe(ipcRenderer, "dock:open-artifact", callback),

  onShortcut: (
    callback: (payload: DockShortcutRequest) => void,
  ): Unsubscribe => subscribe(ipcRenderer, "dock:shortcut", callback),
});
