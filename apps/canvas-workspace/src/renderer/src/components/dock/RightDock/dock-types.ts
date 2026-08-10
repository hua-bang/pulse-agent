import type { CanvasConfigScope, CanvasSkillEntry } from '../../../types';

export type DockPreviewTab =
  | { id: string; kind: 'artifact'; title: string; workspaceId: string; artifactId: string }
  | {
    id: string;
    kind: 'link';
    title: string;
    url: string;
    faviconUrl?: string;
    /** Tab this one was opened from — drives browser-style placement next to
     *  its opener instead of at the far end of the strip. */
    openerTabId?: string;
  }
  | { id: string; kind: 'node-detail'; title: string; workspaceId: string; nodeId: string }
  | { id: string; kind: 'canvas'; title: string; workspaceId: string }
  | { id: string; kind: 'skill'; title: string; scope: CanvasConfigScope; skill: CanvasSkillEntry };

/** A workspace whose web tabs stay mounted (hidden) after switching away.
 *  Declared here rather than beside the link helpers so the state shape has
 *  no import cycle with them. */
export interface RetainedLinkWorkspace {
  workspaceId: string;
  tabs: Extract<DockPreviewTab, { kind: 'link' }>[];
  /** Which tab was in front, so switching back restores the same view. */
  activeTabId?: string;
}

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
  /**
   * Web tabs of recently-left workspaces, kept MOUNTED but hidden so
   * switching canvases does not reload every page and lose its scroll
   * position, form state and sign-in. Bounded — see
   * `RETAINED_WORKSPACE_LIMIT`. Never rendered in the tab strip; only
   * `DockPanes` reads it.
   */
  retainedLinkTabs: readonly RetainedLinkWorkspace[];
  /** `CHAT_TAB_ID`, a terminal tab id, or a preview tab id. */
  activeTabId: string;
  /** Content tab shown beside the pinned chat pane in split view. */
  splitTabId?: string;
  expanded: boolean;
  chatUnread: boolean;
  /** When set, Pulse AI renders the dedicated conversation for this task
   *  instead of the active workspace conversation. */
  scheduledChatTaskId?: string;
  /** Incremented after a manual run so the task conversation reloads its
   *  newly persisted result. */
  scheduledChatRevision?: number;
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
