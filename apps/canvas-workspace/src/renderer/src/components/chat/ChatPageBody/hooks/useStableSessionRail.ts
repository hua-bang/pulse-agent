import { useMemo, useRef } from 'react';
import { scopeSessionStoreId } from '../../../../../../shared/agent-chat';
import { conversationKeyId } from '../../../../../../shared/conversation-runtime';
import { useI18n } from '../../../../i18n';
import type { AgentSessionInfo } from '../../../../types';
import type { UnifiedSession } from '../../ChatSessionsRail';
import type { AgentScope, OtherWorkspaceSession, WorkspaceOption } from '../../../../types';
import type { ConversationCompletionStatus } from '../../../../agent-chat/runtime/conversationCompletionStore';

interface UseStableSessionRailOptions {
  agentScope: AgentScope;
  allWorkspaces: WorkspaceOption[];
  currentScopeName: string | null;
  loading: boolean;
  otherSessions: OtherWorkspaceSession[];
  selectedSessionKey: string | null;
  sessions: AgentSessionInfo[];
  sessionsStoreId: string;
  /** Conversation session ids with an active run (parallel running markers). */
  runningSessionIds?: ReadonlySet<string>;
  completionStatuses?: ReadonlyMap<string, ConversationCompletionStatus>;
}

const deduplicateSessions = (sessions: UnifiedSession[]): UnifiedSession[] => {
  const seen = new Set<string>();
  return sessions.filter((session) => {
    const key = `${session.workspaceId}:${session.sessionId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

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
  runningSessionIds,
  completionStatuses,
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
    // Current-scope rows come first and carry the freshest pointer/runtime
    // state. Cross-workspace scans can briefly return the same durable row
    // during a scope transition, so keep the first row for each conversation.
    const unified = deduplicateSessions([
      ...sessions.map((session) => {
        const isCurrent = selectedSessionKey
          ? selectedSessionKey === `${sessionsStoreId}:${session.sessionId}`
          : session.isCurrent;
        return {
          ...session,
          preview: session.title ?? session.preview,
          isPinned: session.pinned,
          // The conversation the user is VIEWING does not need a Running badge
          // (its stream is on screen); only background-running sessions do.
          running: runningSessionIds?.has(session.sessionId) && !isCurrent,
          completionStatus: !isCurrent ? completionStatuses?.get(conversationKeyId({
            storeId: sessionsStoreId,
            sessionId: session.sessionId,
          })) : undefined,
          workspaceId: sessionsStoreId,
          workspaceName,
          isCurrent,
        };
      }),
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
        completionStatus: selectedSessionKey !== `${session.sourceWorkspaceId}:${session.sessionId}`
          ? completionStatuses?.get(conversationKeyId({
            storeId: session.sourceWorkspaceId,
            sessionId: session.sessionId,
          }))
          : undefined,
      })),
    ]);
    return unified.sort((left, right) => (
      (right.updatedAt ?? 0) - (left.updatedAt ?? 0)
      || right.date.localeCompare(left.date)
      || right.sessionId.localeCompare(left.sessionId)
    ));
  }, [agentScope, allWorkspaces, completionStatuses, currentScopeName, otherSessions, runningSessionIds, selectedSessionKey, sessions, sessionsStoreId, t]);

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
