import type { AgentScope } from '../../chat/types';

export type DockScope =
  | { kind: 'global' }
  | { kind: 'workspace'; workspaceId: string };

/** Internal key for the workspace-independent Dock session. It deliberately
 * differs from the agent session-store sentinel: Dock routing is UI state,
 * not chat persistence. */
export const GLOBAL_DOCK_SCOPE_KEY = '__global_dock__';

export const dockScopeKey = (scope: DockScope): string =>
  scope.kind === 'workspace' ? scope.workspaceId : GLOBAL_DOCK_SCOPE_KEY;

/** The single policy boundary from page/conversation state to Dock tabs.
 * If workspace Chat should become global later, only this mapping changes. */
export function resolveDockScope(
  activeView: string,
  activeCanvasWorkspaceId: string,
  chatScope: AgentScope,
): DockScope {
  if (activeView === 'chat') {
    return chatScope.kind === 'workspace'
      ? { kind: 'workspace', workspaceId: chatScope.workspaceId }
      : { kind: 'global' };
  }
  if (activeView === 'scheduled-task') return { kind: 'global' };
  return { kind: 'workspace', workspaceId: activeCanvasWorkspaceId };
}
