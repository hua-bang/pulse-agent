import { useCallback } from 'react';
import type { AgentSessionInfo } from '../../../../types';
import type {
  AgentScope,
  OtherWorkspaceSession,
  WorkspaceOption,
} from '../../types';
import type { ChatSessionsRailProps, UnifiedSession } from '../../ChatSessionsRail';
import { scopeFromSessionStoreId } from '../../../../agent-chat/target/sessionScope';
import { restoreComposerFocusAfterRender } from '../../utils/focusRecovery';
import { useStableSessionRail } from './useStableSessionRail';
import type { ConversationCompletionStatus } from '../../../../agent-chat/runtime/conversationCompletionStore';

interface Options {
  agentScope: AgentScope;
  allWorkspaces: WorkspaceOption[];
  currentScopeName: string | null;
  sessionsLoading: boolean;
  otherSessions: OtherWorkspaceSession[];
  selectedSessionKey: string | null;
  sessions: AgentSessionInfo[];
  sessionsStoreId: string;
  pendingSessionKey?: string | null;
  disabled: boolean;
  newSessionDisabled?: boolean;
  focusInput: () => void;
  handleNewSession: () => Promise<{ ok: boolean }>;
  onNewSessionDraft?: (trigger: Element | null) => void;
  onNewSessionInWorkspace?: (workspaceId: string, trigger: Element | null) => void;
  onClearBackStack?: () => void;
  onSelectSession: (session: UnifiedSession) => void;
  renameSession: (sessionId: string, title: string, scope: AgentScope) => Promise<unknown>;
  deleteSession: (sessionId: string, scope: AgentScope) => Promise<unknown>;
  toggleSessionPinned: (sessionId: string, pinned: boolean, scope: AgentScope) => Promise<unknown>;
  /** Conversation session ids with an active run (parallel running markers). */
  runningSessionIds?: ReadonlySet<string>;
  completionStatuses?: ReadonlyMap<string, ConversationCompletionStatus>;
}

export const useChatPageSessionRail = ({
  agentScope,
  allWorkspaces,
  currentScopeName,
  sessionsLoading,
  otherSessions,
  selectedSessionKey,
  sessions,
  sessionsStoreId,
  pendingSessionKey,
  disabled,
  newSessionDisabled = disabled,
  focusInput,
  handleNewSession,
  onNewSessionDraft,
  onNewSessionInWorkspace,
  onClearBackStack,
  onSelectSession,
  renameSession,
  deleteSession,
  toggleSessionPinned,
  runningSessionIds,
  completionStatuses,
}: Options): ChatSessionsRailProps => {
  const allSessions = useStableSessionRail({
    agentScope,
    allWorkspaces,
    currentScopeName,
    loading: sessionsLoading,
    otherSessions,
    selectedSessionKey,
    sessions,
    sessionsStoreId,
    runningSessionIds,
    completionStatuses,
  });
  const onNewSession = useCallback(async () => {
    if (newSessionDisabled) return;
    const trigger = document.activeElement;
    if (onNewSessionDraft) {
      onNewSessionDraft(trigger);
      return;
    }
    onClearBackStack?.();
    const result = await handleNewSession();
    if (result.ok) restoreComposerFocusAfterRender(focusInput, trigger);
  }, [focusInput, handleNewSession, newSessionDisabled, onClearBackStack, onNewSessionDraft]);
  const onSelect = useCallback((session: UnifiedSession) => {
    if (!disabled) onSelectSession(session);
  }, [disabled, onSelectSession]);
  const onRename = useCallback(async (session: UnifiedSession, title: string) => {
    await renameSession(session.sessionId, title, scopeFromSessionStoreId(session.workspaceId));
  }, [renameSession]);
  const onDelete = useCallback(async (session: UnifiedSession) => {
    await deleteSession(session.sessionId, scopeFromSessionStoreId(session.workspaceId));
  }, [deleteSession]);
  const onTogglePin = useCallback(async (session: UnifiedSession) => {
    await toggleSessionPinned(
      session.sessionId,
      !session.isPinned,
      scopeFromSessionStoreId(session.workspaceId),
    );
  }, [toggleSessionPinned]);

  return {
    allSessions,
    workspaces: allWorkspaces,
    loading: sessionsLoading,
    disabled,
    newSessionDisabled,
    pendingSessionKey,
    onNewSession,
    onNewSessionInWorkspace,
    onSelectSession: onSelect,
    onRenameSession: onRename,
    onDeleteSession: onDelete,
    onTogglePinSession: onTogglePin,
  };
};
