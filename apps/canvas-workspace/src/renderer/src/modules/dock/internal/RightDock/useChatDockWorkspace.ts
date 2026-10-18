import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AgentScope } from '../../../../types';
import { resolveDockWorkspaceId } from './state/dock-workspace';

/** Keeps the full-page Chat dock aligned with its conversation without letting
 * tab activation silently replace that conversation-owned scope. */
export function useChatDockWorkspace(
  activeView: string,
  activeCanvasWorkspaceId: string,
  entryScope: AgentScope | undefined,
  selectCanvasWorkspace: (workspaceId: string) => void,
  collapseDock?: () => void,
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
  // A prompt sent from the Launcher starts a new conversation, so the page
  // opens on that conversation alone. The scope's previous tabs stay in the
  // dock, one "Tabs" click away. RightDock switches its scope in a child
  // layout effect, which runs first, so this collapses the incoming scope
  // before the first paint.
  const pendingCollapseRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (activeView !== 'chat' || pendingCollapseRef.current !== dockWorkspaceId) return;
    pendingCollapseRef.current = null;
    collapseDock?.();
  }, [activeView, collapseDock, dockWorkspaceId]);
  const collapseDockOnEntry = useCallback((scope: AgentScope) => {
    pendingCollapseRef.current = resolveDockWorkspaceId(
      'chat',
      activeCanvasWorkspaceId,
      scope.kind === 'workspace' ? scope.workspaceId : null,
    );
  }, [activeCanvasWorkspaceId]);
  const activateDockWorkspace = useCallback((workspaceId: string) => {
    if (activeView === 'chat') return false;
    selectCanvasWorkspace(workspaceId);
    return true;
  }, [activeView, selectCanvasWorkspace]);

  return {
    dockWorkspaceId,
    reportChatWorkspace: setReportedWorkspaceId,
    activateDockWorkspace,
    collapseDockOnEntry,
  };
}
