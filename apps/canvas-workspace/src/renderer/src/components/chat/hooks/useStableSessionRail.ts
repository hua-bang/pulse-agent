import { useMemo, useRef } from 'react';
import { scopeSessionStoreId } from '../../../../../shared/agent-chat';
import { useI18n } from '../../../i18n';
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
  sessionsStoreId: string;
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
  sessionsStoreId,
}: UseStableSessionRailOptions): UnifiedSession[] {
  const { t } = useI18n();
  const stableSessionsRef = useRef<UnifiedSession[]>([]);
  const stableScopeRef = useRef(scopeSessionStoreId(agentScope));
  const computedSessions = useMemo(() => {
    const activeStoreId = scopeSessionStoreId(agentScope);
    const workspaceId = sessionsStoreId === activeStoreId && agentScope.kind === 'workspace'
      ? agentScope.workspaceId
      : sessionsStoreId;
    const workspaceName = currentScopeName
      ?? (sessionsStoreId === '__global_chat__'
        ? t('chat.scope.global')
        : allWorkspaces.find((workspace) => workspace.id === workspaceId)?.name ?? workspaceId);
    const unified: UnifiedSession[] = [
      ...sessions.map((session) => ({
        ...session,
        preview: session.title ?? session.preview,
        isPinned: session.pinned,
        workspaceId: sessionsStoreId,
        workspaceName,
        isCurrent: selectedSessionKey
          ? selectedSessionKey === `${sessionsStoreId}:${session.sessionId}`
          : session.isCurrent,
      })),
      ...otherSessions.map((session) => ({
        sessionId: session.sessionId,
        workspaceId: session.sourceWorkspaceId,
        workspaceName: session.workspaceName,
        date: session.date,
        updatedAt: session.updatedAt,
        messageCount: session.messageCount,
        preview: session.title ?? session.preview,
        isPinned: session.pinned,
        isCurrent: selectedSessionKey
          === `${session.sourceWorkspaceId}:${session.sessionId}`,
      })),
    ];
    return unified.sort((left, right) => (
      (right.updatedAt ?? 0) - (left.updatedAt ?? 0)
      || right.date.localeCompare(left.date)
      || right.sessionId.localeCompare(left.sessionId)
    ));
  }, [agentScope, allWorkspaces, currentScopeName, otherSessions, selectedSessionKey, sessions, sessionsStoreId, t]);

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
