import type { AgentContextTabRef } from '../../../../types';
import type { DockState } from '../../../../components/dock/RightDock/dock-store';
import { buildDockTabRefs } from '../../../../components/dock/RightDock/tabRefs';

const UNBOUND_DOCK_WORKSPACE_ID = '__default__';

/**
 * Project the actual RightDock beside the full-page chat into explicit
 * `@Tab` candidates. Chat scope and dock ownership are deliberately separate:
 * a global or historical chat may sit beside the currently active workspace's
 * dock, and merely showing a tab never injects it into the request context.
 */
export function buildChatPageDockTabRefs(state: DockState): AgentContextTabRef[] {
  const dockWorkspaceId = state.activeTerminalWorkspaceId;
  if (!dockWorkspaceId || dockWorkspaceId === UNBOUND_DOCK_WORKSPACE_ID) return [];
  return buildDockTabRefs(state, dockWorkspaceId);
}
