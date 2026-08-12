import { useCallback, useEffect, useState } from 'react';
import type { ActiveChatTarget } from '../../chat/ChatTargetContext';
import { chatScopeKey } from '../../../../../shared/agent-chat';
import { resolveDockWorkspaceId } from './dock-workspace';

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

  const chatWorkspaceId = activeChatTarget.scope.kind === 'workspace'
    ? activeChatTarget.scope.workspaceId
    : null;
  const dockWorkspaceId = resolveDockWorkspaceId(
    activeView,
    activeCanvasWorkspaceId,
    chatWorkspaceId,
  );
  const dockOwnerWorkspaceId = activeView === 'chat'
    ? (dockWorkspaceOverride?.scopeKey === activeScopeKey
        ? dockWorkspaceOverride.workspaceId
        : null) ?? dockWorkspaceId ?? activeCanvasWorkspaceId
    : dockWorkspaceId ?? activeCanvasWorkspaceId;
  const activateDockWorkspace = useCallback((workspaceId: string) => {
    if (activeView === 'chat') {
      setDockWorkspaceOverride({ scopeKey: activeScopeKey, workspaceId });
      return;
    }
    selectCanvasWorkspace(workspaceId);
  }, [activeScopeKey, activeView, selectCanvasWorkspace]);

  return {
    dockWorkspaceId,
    dockOwnerWorkspaceId,
    activateDockWorkspace,
  };
}
