import { useMemo } from 'react';
import type { AgentSessionInfo } from '../../../types';
import {
  GLOBAL_CHAT_STORE_ID,
  scheduledTaskIdFromStoreId,
  scopeSessionStoreId,
} from '../../../../../shared/agent-chat';
import type { AgentScope, OtherWorkspaceSession, WorkspaceOption } from '../types';
import { useI18n } from '../../../i18n';
import { useConversationSnapshots } from './conversationStore';

interface Options {
  agentScope: AgentScope;
  allWorkspaces?: WorkspaceOption[];
  activeSessionId: string | null;
  sessions: AgentSessionInfo[];
  otherSessions: OtherWorkspaceSession[];
}

const liveSessionInfo = (
  snapshot: ReturnType<typeof useConversationSnapshots>[number],
  isCurrent: boolean,
) => {
  const firstUser = snapshot.messages.find(message => message.role === 'user');
  if (snapshot.status !== 'running' || !firstUser) return null;
  const latestTimestamp = snapshot.messages.reduce(
    (latest, message) => Math.max(latest, message.timestamp ?? 0),
    firstUser.timestamp ?? 0,
  );
  const timestamp = latestTimestamp || Date.now();
  return {
    sessionId: snapshot.key.sessionId,
    date: new Date(timestamp).toISOString().slice(0, 10),
    updatedAt: timestamp,
    messageCount: snapshot.messages.length,
    preview: firstUser.content,
    isCurrent,
    pinned: false,
  } satisfies AgentSessionInfo;
};

const mergeLiveSessions = <T extends AgentSessionInfo>(
  listed: T[],
  live: T[],
): T[] => {
  if (live.length === 0) return listed;
  const liveById = new Map(live.map(session => [session.sessionId, session]));
  const merged = listed.map(session => {
    const active = liveById.get(session.sessionId);
    if (!active) return session;
    liveById.delete(session.sessionId);
    return {
      ...session,
      messageCount: active.messageCount,
      preview: active.preview ?? session.preview,
      updatedAt: Math.max(session.updatedAt ?? 0, active.updatedAt ?? 0),
    } as T;
  });
  return [...liveById.values(), ...merged];
};

export function useLiveSessionLists({
  agentScope,
  allWorkspaces,
  activeSessionId,
  sessions,
  otherSessions,
}: Options): { sessions: AgentSessionInfo[]; otherSessions: OtherWorkspaceSession[] } {
  const { t } = useI18n();
  const conversationSnapshots = useConversationSnapshots();
  return useMemo(() => {
    const currentStoreId = scopeSessionStoreId(agentScope);
    const current: AgentSessionInfo[] = [];
    const other: OtherWorkspaceSession[] = [];
    const workspaceNames = new Map((allWorkspaces ?? []).map(workspace => [workspace.id, workspace.name]));
    for (const snapshot of conversationSnapshots) {
      const currentRow = liveSessionInfo(snapshot, snapshot.key.sessionId === activeSessionId);
      if (!currentRow) continue;
      if (snapshot.key.storeId === currentStoreId) {
        current.push(currentRow);
        continue;
      }
      if (!allWorkspaces) continue;
      const taskId = scheduledTaskIdFromStoreId(snapshot.key.storeId);
      const workspaceName = snapshot.key.storeId === GLOBAL_CHAT_STORE_ID
        ? t('chat.scope.global')
        : workspaceNames.get(snapshot.key.storeId) ?? taskId ?? snapshot.key.storeId;
      other.push({
        ...currentRow,
        isCurrent: false,
        sourceWorkspaceId: snapshot.key.storeId,
        workspaceName,
      });
    }
    return {
      sessions: mergeLiveSessions(sessions, current),
      otherSessions: mergeLiveSessions(otherSessions, other),
    };
  }, [activeSessionId, agentScope, allWorkspaces, conversationSnapshots, otherSessions, sessions, t]);
}
