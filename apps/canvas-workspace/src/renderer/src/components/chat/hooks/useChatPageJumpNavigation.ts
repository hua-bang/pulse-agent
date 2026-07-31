import { useCallback, useMemo } from 'react';
import type { AgentChatMessage } from '../../../types';
import type { AgentScope, WorkspaceOption } from '../types';
import type { UnifiedSession } from '../ChatSessionsRail';
import type { SessionBackEntry } from '../SessionBackBar';
import { buildAnchorElementId, buildChatAnchors } from '../utils/anchors';
import { sessionTitleText } from '../utils/sessionTitle';
import { scopeSessionStoreId } from '../../../../../shared/agent-chat';

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
  allWorkspaces: WorkspaceOption[];
  messages: AgentChatMessage[];
  scopeId: string;
  handleLoadSession: (sessionId: string) => Promise<boolean | undefined>;
  onJumpToSession?: (session: { sessionId: string; workspaceId: string }) => void;
  onPushBackEntry?: (entry: SessionBackEntry) => void;
  onSelectSession: (session: UnifiedSession) => void;
}

export const useChatPageJumpNavigation = ({
  agentScope,
  allWorkspaces,
  messages,
  scopeId,
  handleLoadSession,
  onJumpToSession,
  onPushBackEntry,
  onSelectSession,
}: Options) => {
  const currentSessionLabel = useMemo(() => {
    const firstUser = messages.find(message => message.role === 'user')?.content.trim();
    if (!firstUser) return '';
    const cleaned = sessionTitleText(firstUser);
    return cleaned.length > 24 ? `${cleaned.slice(0, 23)}…` : cleaned;
  }, [messages]);
  const currentSessionStoreId = scopeSessionStoreId(agentScope);

  const onSessionJump = useCallback(async (
    sessionId: string,
    targetScopeId: string,
    messageIndex?: number,
  ) => {
    try {
      const current = await window.canvasWorkspace.agent.getCurrentSession({ scope: agentScope });
      if (current.ok && current.sessionId && current.sessionId !== sessionId) {
        onPushBackEntry?.({
          sessionId: current.sessionId,
          workspaceId: currentSessionStoreId,
          label: currentSessionLabel,
        });
      }
    } catch {
      // Back-navigation is best-effort; opening the target still proceeds.
    }

    if (onJumpToSession) {
      onJumpToSession({ sessionId, workspaceId: targetScopeId });
    } else if (targetScopeId === currentSessionStoreId) {
      await handleLoadSession(sessionId);
    } else {
      onSelectSession({
        sessionId,
        workspaceId: targetScopeId,
        workspaceName: allWorkspaces.find(workspace => workspace.id === targetScopeId)?.name ?? targetScopeId,
        date: '',
        messageCount: 0,
        preview: '',
        isCurrent: false,
      });
    }
    if (messageIndex !== undefined && messageIndex >= 0) {
      flashAnchor(targetScopeId, messageIndex, 200);
    }
  }, [
    agentScope,
    allWorkspaces,
    currentSessionLabel,
    currentSessionStoreId,
    handleLoadSession,
    onJumpToSession,
    onPushBackEntry,
    onSelectSession,
    scopeId,
  ]);
  const anchors = useMemo(() => buildChatAnchors(messages), [messages]);
  const onJumpAnchor = useCallback(
    (messageIndex: number) => flashAnchor(scopeId, messageIndex),
    [scopeId],
  );

  return { anchors, onJumpAnchor, onSessionJump };
};
