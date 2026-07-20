import type { AgentContextTabRef } from '../../../shared/agent-chat';

/**
 * Renderer → main bridge for right-dock state the Canvas Agent needs to see.
 * The dock's tab list lives in the renderer; publishing a snapshot lets the
 * `canvas_list_tabs` agent tool enumerate open tabs.
 */
export interface DockApi {
  /** Push the current workspace's open dock tabs to main (fire-and-forget). */
  publishTabs: (workspaceId: string, tabs: AgentContextTabRef[]) => void;
  /** Main asks the dock to bring a tab to the front (Canvas Agent tab ops). Returns unsubscribe fn. */
  onActivateTab: (callback: (payload: { workspaceId: string; tabId: string }) => void) => () => void;
  /** Main asks the dock to open a URL as a web tab (or navigate the existing
   *  link tab `tabId`). Returns unsubscribe fn. */
  onOpenTab: (callback: (payload: { url: string; tabId?: string }) => void) => () => void;
  /** Main asks the dock to open an artifact pane (workspaceId is the
   *  artifact's storage scope, e.g. `__global_chat__`). Returns unsubscribe fn. */
  onOpenArtifact: (
    callback: (payload: { workspaceId: string; artifactId: string }) => void,
  ) => () => void;
}
