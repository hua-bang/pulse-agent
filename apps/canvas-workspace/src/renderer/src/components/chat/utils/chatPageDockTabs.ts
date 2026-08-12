import type { AgentContextTabRef } from '../../../types';
import type { DockState } from '../../dock/RightDock/dock-store';
import { buildDockTabRefs } from '../../dock/RightDock/tabRefs';

const UNBOUND_DOCK_WORKSPACE_ID = '__default__';

/**
 * Project the actual RightDock beside the full-page chat into explicit
 * `@Tab` candidates. Chat scope and dock ownership are deliberately separate:
 * global and scheduled chats share the workspace-independent Dock session,
 * and merely showing a tab never injects it into the request context.
 */
export function buildChatPageDockTabRefs(state: DockState): AgentContextTabRef[] {
  const dockWorkspaceId = state.activeTerminalWorkspaceId;
  if (!dockWorkspaceId || dockWorkspaceId === UNBOUND_DOCK_WORKSPACE_ID) return [];
  return buildDockTabRefs(state, dockWorkspaceId);
}
