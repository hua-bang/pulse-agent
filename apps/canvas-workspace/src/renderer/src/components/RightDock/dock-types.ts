export type DockPreviewTab =
  | { id: string; kind: 'artifact'; title: string; workspaceId: string; artifactId: string }
  | { id: string; kind: 'link'; title: string; url: string; faviconUrl?: string }
  | { id: string; kind: 'node-detail'; title: string; workspaceId: string; nodeId: string }
  | { id: string; kind: 'canvas'; title: string; workspaceId: string };

export interface DockTerminalTab {
  id: string;
  title?: string;
  ordinal: number;
  agentType?: string;
}

export interface DockTerminalWorkspaceState {
  tabs: DockTerminalTab[];
  activeTabId?: string;
  nextOrdinal: number;
}

export interface DockState {
  /** Preview tabs only — chat is pinned and implicit. */
  tabs: DockPreviewTab[];
  /** `CHAT_TAB_ID`, a terminal tab id, or a preview tab id. */
  activeTabId: string;
  /** Content tab shown beside the pinned chat pane in split view. */
  splitTabId?: string;
  expanded: boolean;
  chatUnread: boolean;
  terminalTabsByWorkspace: Record<string, DockTerminalWorkspaceState>;
  activeTerminalWorkspaceId: string;
  terminalTabs: DockTerminalTab[];
  activeTerminalTabId?: string;
  nextTerminalOrdinal: number;
  /** Compatibility flag for callers that only need to know whether any terminal exists. */
  terminalOpen: boolean;
  /** Workspaces currently mounted (live) by the main Workbench — the active
   *  one plus recency/terminal-kept background canvases. Published by the
   *  Workbench so the dock never previews a canvas that's already live. */
  mountedWorkspaceIds: ReadonlySet<string>;
}
