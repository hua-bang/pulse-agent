import { useCallback, useMemo, useState } from 'react';
import type { AgentChatMessage } from '../../../../../types';
import { useI18n } from '../../../../../i18n';
import type {
  AgentScope,
  OtherWorkspaceSession,
  WorkspaceOption,
} from '../../../../../types';
import type { SessionBackEntry } from '../../SessionBackBar';
import { buildAnchorElementId, buildChatAnchors } from '../../utils/anchors';
import { restoreComposerFocusAfterRender } from '../../utils/focusRecovery';
import { scopeFromSessionStoreId } from '../../../target/sessionScope';

const flashAnchor = (scopeId: string, messageIndex: number, delay = 0) => {
  window.setTimeout(() => {
    const element = document.getElementById(buildAnchorElementId(scopeId, messageIndex));
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    element.classList.add('chat-message--anchor-flash');
    window.setTimeout(() => element.classList.remove('chat-message--anchor-flash'), 1200);
  }, delay);
};

interface Options {
  agentScope: AgentScope;
  allWorkspaces?: WorkspaceOption[];
  scopeId: string;
  sessionTitle: string;
  messages: AgentChatMessage[];
  busy: boolean;
  focusInput: () => void;
  closeSessionMenu: () => void;
  handleNewSession: () => Promise<{ ok: boolean }>;
  handleLoadSession: (
    sessionId: string,
    sourceWorkspaceId?: string,
  ) => Promise<boolean | undefined>;
  onOpenSessionInScope?: (scope: AgentScope, sessionId: string, scopeLabel: string) => void;
}

export const useChatPanelSessionNavigation = ({
  agentScope,
  allWorkspaces,
  scopeId,
  sessionTitle,
  messages,
  busy,
  focusInput,
  closeSessionMenu,
  handleNewSession,
  handleLoadSession,
  onOpenSessionInScope,
}: Options) => {
  const { t } = useI18n();
  const [backStack, setBackStack] = useState<SessionBackEntry[]>([]);
  const openScopeLabel = useCallback((storeId: string) => {
    const scope = scopeFromSessionStoreId(storeId);
    if (scope.kind === 'global') return t('chat.scope.global');
    if (scope.kind === 'scheduled') return t('chat.scope.scheduled');
    return allWorkspaces?.find(workspace => workspace.id === scope.workspaceId)?.name
      ?? scope.workspaceId;
  }, [allWorkspaces, t]);
  const jumpToSession = useCallback(async (
    sessionId: string,
    targetScopeId: string,
    messageIndex?: number,
  ) => {
    if (targetScopeId !== scopeId && onOpenSessionInScope) {
      closeSessionMenu();
      onOpenSessionInScope(
        scopeFromSessionStoreId(targetScopeId),
        sessionId,
        openScopeLabel(targetScopeId),
      );
      return;
    }
    await handleLoadSession(sessionId);
    if (messageIndex !== undefined && messageIndex >= 0) {
      flashAnchor(scopeId, messageIndex, 120);
    }
  }, [closeSessionMenu, handleLoadSession, onOpenSessionInScope, openScopeLabel, scopeId]);
  const onSessionJump = useCallback(async (
    sessionId: string,
    targetScopeId: string,
    messageIndex?: number,
  ) => {
    try {
      const current = await window.canvasWorkspace.agent.getCurrentSession({ scope: agentScope });
      const currentSessionId = current.sessionId;
      if (current.ok && currentSessionId && currentSessionId !== sessionId) {
        setBackStack(previous => [...previous, {
          sessionId: currentSessionId,
          workspaceId: scopeId,
          label: sessionTitle,
        }]);
      }
    } catch {
      // A missing back entry must not block the requested navigation.
    }
    await jumpToSession(sessionId, targetScopeId, messageIndex);
  }, [agentScope, jumpToSession, scopeId, sessionTitle]);
  const onSessionBack = useCallback(async () => {
    const entry = backStack[backStack.length - 1];
    if (!entry) return;
    setBackStack(previous => previous.slice(0, -1));
    await jumpToSession(entry.sessionId, entry.workspaceId);
  }, [backStack, jumpToSession]);
  const onNewSession = useCallback(async () => {
    if (busy) return;
    const trigger = document.activeElement;
    setBackStack([]);
    const result = await handleNewSession();
    if (result.ok) restoreComposerFocusAfterRender(focusInput, trigger);
  }, [busy, focusInput, handleNewSession]);
  const onLoadSession = useCallback(async (sessionId: string) => {
    if (busy) return;
    setBackStack([]);
    await handleLoadSession(sessionId);
  }, [busy, handleLoadSession]);
  const onOpenOriginalSession = useCallback((session: OtherWorkspaceSession) => {
    if (!onOpenSessionInScope) return;
    closeSessionMenu();
    onOpenSessionInScope(
      scopeFromSessionStoreId(session.sourceWorkspaceId),
      session.sessionId,
      session.workspaceName,
    );
  }, [closeSessionMenu, onOpenSessionInScope]);
  const onCopyOtherSession = useCallback(async (session: OtherWorkspaceSession) => {
    if (busy) return;
    setBackStack([]);
    await handleLoadSession(session.sessionId, session.sourceWorkspaceId);
  }, [busy, handleLoadSession]);
  const anchors = useMemo(() => buildChatAnchors(messages), [messages]);
  const onJumpAnchor = useCallback(
    (messageIndex: number) => flashAnchor(scopeId, messageIndex),
    [scopeId],
  );

  return {
    anchors,
    backEntry: backStack[backStack.length - 1],
    onCopyOtherSession,
    onJumpAnchor,
    onLoadSession,
    onNewSession,
    onOpenOriginalSession,
    onSessionBack,
    onSessionJump,
    setBackStack,
  };
};
