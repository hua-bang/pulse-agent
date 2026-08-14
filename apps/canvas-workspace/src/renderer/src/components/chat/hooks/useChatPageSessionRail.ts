import { useCallback } from 'react';
import type { AgentSessionInfo } from '../../../types';
import type {
  AgentScope,
  OtherWorkspaceSession,
  WorkspaceOption,
} from '../types';
import type { ChatSessionsRailProps, UnifiedSession } from '../ChatSessionsRail';
import { restoreComposerFocusAfterRender } from '../utils/focusRecovery';
import { useStableSessionRail } from './useStableSessionRail';

interface Options {
  agentScope: AgentScope;
  allWorkspaces: WorkspaceOption[];
  currentScopeName: string | null;
  sessionsLoading: boolean;
  otherSessions: OtherWorkspaceSession[];
  selectedSessionKey: string | null;
  sessions: AgentSessionInfo[];
  sessionsScope: AgentScope;
  pendingSessionKey?: string | null;
  disabled: boolean;
  focusInput: () => void;
  handleNewSession: () => Promise<{ ok: boolean }>;
  onClearBackStack?: () => void;
  onSelectSession: (session: UnifiedSession) => void;
  renameSession: (sessionId: string, title: string, scope: AgentScope) => Promise<unknown>;
  deleteSession: (sessionId: string, scope: AgentScope) => Promise<unknown>;
  toggleSessionPinned: (sessionId: string, pinned: boolean, scope: AgentScope) => Promise<unknown>;
}

export const useChatPageSessionRail = ({
  agentScope,
  allWorkspaces,
  currentScopeName,
  sessionsLoading,
  otherSessions,
  selectedSessionKey,
  sessions,
  sessionsScope,
  pendingSessionKey,
  disabled,
  focusInput,
  handleNewSession,
  onClearBackStack,
  onSelectSession,
  renameSession,
  deleteSession,
  toggleSessionPinned,
}: Options): ChatSessionsRailProps => {
  const allSessions = useStableSessionRail({
    agentScope,
    allWorkspaces,
    currentScopeName,
    loading: sessionsLoading,
    otherSessions,
    selectedSessionKey,
    sessions,
    sessionsScope,
  });
  const onNewSession = useCallback(async () => {
    if (disabled) return;
    const trigger = document.activeElement;
    onClearBackStack?.();
    const result = await handleNewSession();
    if (result.ok) restoreComposerFocusAfterRender(focusInput, trigger);
  }, [disabled, focusInput, handleNewSession, onClearBackStack]);
  const onSelect = useCallback((session: UnifiedSession) => {
    if (!disabled) onSelectSession(session);
  }, [disabled, onSelectSession]);
  const onRename = useCallback(async (session: UnifiedSession, title: string) => {
    await renameSession(session.sessionId, title, session.scope);
  }, [renameSession]);
  const onDelete = useCallback(async (session: UnifiedSession) => {
    await deleteSession(session.sessionId, session.scope);
  }, [deleteSession]);
  const onTogglePin = useCallback(async (session: UnifiedSession) => {
    await toggleSessionPinned(
      session.sessionId,
      !session.isPinned,
      session.scope,
    );
  }, [toggleSessionPinned]);

  return {
    allSessions,
    loading: sessionsLoading,
    disabled,
    pendingSessionKey,
    onNewSession,
    onSelectSession: onSelect,
    onRenameSession: onRename,
    onDeleteSession: onDelete,
    onTogglePinSession: onTogglePin,
  };
};
