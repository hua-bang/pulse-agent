import { useMemo, useRef } from 'react';
import { scopeSessionStoreId } from '../../../../../shared/agent-chat';
import type { AgentSessionInfo } from '../../../types';
import type { UnifiedSession } from '../ChatSessionsRail';
import type { AgentScope, OtherWorkspaceSession, WorkspaceOption } from '../types';

interface UseStableSessionRailOptions {
  agentScope: AgentScope;
  allWorkspaces: WorkspaceOption[];
  currentScopeName: string | null;
  loading: boolean;
  otherSessions: OtherWorkspaceSession[];
  selectedSessionKey: string | null;
  sessions: AgentSessionInfo[];
}

/**
 * Keeps the last complete cross-scope session tree visible while a new scope
 * loads. Scope changes are detected during render, before the loading layout
 * effect runs, so the rail never receives "new scope + old list" for one
 * transient commit.
 */
export function useStableSessionRail({
  agentScope,
  allWorkspaces,
  currentScopeName,
  loading,
  otherSessions,
  selectedSessionKey,
  sessions,
}: UseStableSessionRailOptions): UnifiedSession[] {
  const stableSessionsRef = useRef<UnifiedSession[]>([]);
  const stableScopeRef = useRef(scopeSessionStoreId(agentScope));
  const computedSessions = useMemo(() => {
    const storeId = scopeSessionStoreId(agentScope);
    const workspaceId = agentScope.kind === 'workspace' ? agentScope.workspaceId : undefined;
    const workspaceName = currentScopeName
      ?? (workspaceId
        ? allWorkspaces.find((workspace) => workspace.id === workspaceId)?.name ?? workspaceId
        : 'Global Chat');
    const unified: UnifiedSession[] = [
      ...sessions.map((session) => ({
        ...session,
        preview: session.title ?? session.preview,
        isPinned: session.pinned,
        workspaceId: storeId,
        workspaceName,
        isCurrent: selectedSessionKey
          ? selectedSessionKey === `${storeId}:${session.sessionId}`
          : session.isCurrent,
      })),
      ...otherSessions.map((session) => ({
        sessionId: session.sessionId,
        workspaceId: session.sourceWorkspaceId,
        workspaceName: session.workspaceName,
        date: session.date,
        messageCount: session.messageCount,
        preview: session.title ?? session.preview,
        isPinned: session.pinned,
        isCurrent: selectedSessionKey
          === `${session.sourceWorkspaceId}:${session.sessionId}`,
      })),
    ];
    return unified.sort((left, right) => (
      right.date.localeCompare(left.date)
      || right.sessionId.localeCompare(left.sessionId)
    ));
  }, [agentScope, allWorkspaces, currentScopeName, otherSessions, selectedSessionKey, sessions]);

  return useMemo(() => {
    const nextScopeId = scopeSessionStoreId(agentScope);
    const scopeChanged = stableScopeRef.current !== nextScopeId;
    if (scopeChanged) stableScopeRef.current = nextScopeId;
    if ((scopeChanged || loading) && stableSessionsRef.current.length > 0) {
      return stableSessionsRef.current.map((session) => ({
        ...session,
        isCurrent: selectedSessionKey
          ? selectedSessionKey === `${session.workspaceId}:${session.sessionId}`
          : session.isCurrent,
      }));
    }
    stableSessionsRef.current = computedSessions;
    return computedSessions;
  }, [agentScope, computedSessions, loading, selectedSessionKey]);
}
