import { useMemo, useRef } from 'react';
import type { AgentSessionInfo } from '../../../types';
import type { UnifiedSession } from '../ChatSessionsRail';
import type { AgentScope, OtherWorkspaceSession, WorkspaceOption } from '../types';
import { chatScopeKey, chatSessionKey } from '../utils/sessionScope';

interface UseStableSessionRailOptions {
  agentScope: AgentScope;
  allWorkspaces: WorkspaceOption[];
  currentScopeName: string | null;
  loading: boolean;
  otherSessions: OtherWorkspaceSession[];
  selectedSessionKey: string | null;
  sessions: AgentSessionInfo[];
  sessionsScope: AgentScope;
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
  sessionsScope,
}: UseStableSessionRailOptions): UnifiedSession[] {
  const stableSessionsRef = useRef<UnifiedSession[]>([]);
  const stableScopeRef = useRef(chatScopeKey(agentScope));
  const computedSessions = useMemo(() => {
    const workspaceName = currentScopeName
      ?? (sessionsScope.kind === 'global'
        ? 'Global Chat'
        : sessionsScope.kind === 'scheduled'
          ? sessionsScope.taskId
          : allWorkspaces.find((workspace) => workspace.id === sessionsScope.workspaceId)?.name
            ?? sessionsScope.workspaceId);
    const unified: UnifiedSession[] = [
      ...sessions.map((session) => ({
        ...session,
        preview: session.title ?? session.preview,
        isPinned: session.pinned,
        scope: sessionsScope,
        scopeName: workspaceName,
        isCurrent: selectedSessionKey
          ? selectedSessionKey === chatSessionKey(sessionsScope, session.sessionId)
          : session.isCurrent,
      })),
      ...otherSessions.map((session) => ({
        sessionId: session.sessionId,
        scope: session.sourceScope,
        scopeName: session.workspaceName,
        date: session.date,
        updatedAt: session.updatedAt,
        messageCount: session.messageCount,
        preview: session.title ?? session.preview,
        isPinned: session.pinned,
        isCurrent: selectedSessionKey
          === chatSessionKey(session.sourceScope, session.sessionId),
      })),
    ];
    return unified.sort((left, right) => (
      (right.updatedAt ?? 0) - (left.updatedAt ?? 0)
      || right.date.localeCompare(left.date)
      || right.sessionId.localeCompare(left.sessionId)
    ));
  }, [allWorkspaces, currentScopeName, otherSessions, selectedSessionKey, sessions, sessionsScope]);

  return useMemo(() => {
    const nextScopeId = chatScopeKey(agentScope);
    const scopeChanged = stableScopeRef.current !== nextScopeId;
    if (scopeChanged) stableScopeRef.current = nextScopeId;
    if ((scopeChanged || loading) && stableSessionsRef.current.length > 0) {
      return stableSessionsRef.current.map((session) => ({
        ...session,
        isCurrent: selectedSessionKey
          ? selectedSessionKey === chatSessionKey(session.scope, session.sessionId)
          : session.isCurrent,
      }));
    }
    stableSessionsRef.current = computedSessions;
    return computedSessions;
  }, [agentScope, computedSessions, loading, selectedSessionKey]);
}
