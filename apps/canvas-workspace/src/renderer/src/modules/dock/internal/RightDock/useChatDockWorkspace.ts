import { useCallback, useEffect, useState } from 'react';
import type { AgentScope } from '../../../../types';
import { resolveDockWorkspaceId } from './dock-workspace';

/** Keeps the full-page Chat dock aligned with its conversation without letting
 * tab activation silently replace that conversation-owned scope. */
export function useChatDockWorkspace(
  activeView: string,
  activeCanvasWorkspaceId: string,
  entryScope: AgentScope | undefined,
  selectCanvasWorkspace: (workspaceId: string) => void,
) {
  // undefined means ChatPage has not reported yet, so the entry target seeds
  // the dock without publishing one frame under the previous Canvas scope.
  const [reportedWorkspaceId, setReportedWorkspaceId] = useState<string | null | undefined>();

  useEffect(() => {
    if (activeView !== 'chat') setReportedWorkspaceId(undefined);
  }, [activeView]);

  const entryWorkspaceId = entryScope?.kind === 'workspace' ? entryScope.workspaceId : null;
  const dockWorkspaceId = resolveDockWorkspaceId(
    activeView,
    activeCanvasWorkspaceId,
    reportedWorkspaceId === undefined ? entryWorkspaceId : reportedWorkspaceId,
  );
  const activateDockWorkspace = useCallback((workspaceId: string) => {
    if (activeView === 'chat') return false;
    selectCanvasWorkspace(workspaceId);
    return true;
  }, [activeView, selectCanvasWorkspace]);

  return {
    dockWorkspaceId,
    reportChatWorkspace: setReportedWorkspaceId,
    activateDockWorkspace,
  };
}
