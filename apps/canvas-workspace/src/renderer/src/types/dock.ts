import type { AgentContextTabRef } from '../../../shared/agent-chat';

/**
 * Renderer → main bridge for right-dock state the Canvas Agent needs to see.
 * The dock's tab list lives in the renderer; publishing a snapshot lets the
 * `canvas_list_tabs` agent tool enumerate open tabs.
 */
export interface DockApi {
  /** Push the current workspace's open dock tabs to main (fire-and-forget). */
  publishTabs: (workspaceId: string, tabs: AgentContextTabRef[]) => void;
}
