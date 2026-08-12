import { useCallback, useEffect, useState } from 'react';
import type { ActiveChatTarget } from '../../chat/ChatTargetContext';
import { chatScopeKey } from '../../../../../shared/agent-chat';
import { dockScopeKey, resolveDockScope } from './dock-workspace';

/** Keeps the full-page Chat dock aligned with its conversation while leaving
 * qualified cross-workspace tab activation as an explicit override. */
export function useChatDockWorkspace(
  activeView: string,
  activeCanvasWorkspaceId: string,
  activeChatTarget: ActiveChatTarget,
  selectCanvasWorkspace: (workspaceId: string) => void,
) {
  const [dockWorkspaceOverride, setDockWorkspaceOverride] = useState<{
    scopeKey: string;
    workspaceId: string;
  } | null>(null);
  const activeScopeKey = chatScopeKey(activeChatTarget.scope);

  useEffect(() => {
    setDockWorkspaceOverride(null);
  }, [activeScopeKey, activeView]);

  const dockScope = resolveDockScope(
    activeView,
    activeCanvasWorkspaceId,
    activeChatTarget.scope,
  );
  const dockWorkspaceId = dockScope.kind === 'workspace'
    ? dockScope.workspaceId
    : null;
  const resolvedDockScopeKey = dockScopeKey(dockScope);
  const isFullPageChat = activeView === 'chat' || activeView === 'scheduled-task';
  const activeDockScopeKey = isFullPageChat
    ? (dockWorkspaceOverride?.scopeKey === activeScopeKey
        ? dockWorkspaceOverride.workspaceId
        : null) ?? resolvedDockScopeKey
    : resolvedDockScopeKey;
  const activateDockWorkspace = useCallback((workspaceId: string) => {
    if (isFullPageChat) {
      setDockWorkspaceOverride({ scopeKey: activeScopeKey, workspaceId });
      return;
    }
    selectCanvasWorkspace(workspaceId);
  }, [activeScopeKey, isFullPageChat, selectCanvasWorkspace]);

  return {
    dockScope,
    dockWorkspaceId,
    dockScopeKey: activeDockScopeKey,
    activateDockWorkspace,
  };
}
