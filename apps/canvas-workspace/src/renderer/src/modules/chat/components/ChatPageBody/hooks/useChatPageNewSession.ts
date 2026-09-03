import { useCallback, useEffect, useRef } from 'react';
import { scopeSessionStoreId } from '../../../../../../../shared/agent-chat';
import type { AgentNewSessionResult, AgentScope } from '../../../../../types';
import { clearChatComposerDraft } from '../../../composer/chatComposerDraftStore';
import { restoreComposerFocusAfterRender } from '../../utils/focusRecovery';

interface Options {
  agentScope: AgentScope;
  sessionStoreId: string;
  sessionLoading: boolean;
  busyElsewhere: boolean;
  pendingSessionId: string | null;
  focusInput: () => void;
  clearInput: () => void;
  handleNewSession: () => Promise<{ ok: boolean }>;
  onClearBackStack?: () => void;
  onCreateNewSessionInScope?: (scope: AgentScope) => Promise<AgentNewSessionResult>;
  onNewSessionCreated?: (scope: AgentScope) => void;
}

/** Coordinates the two full-page New chat entry points and their focus handoff. */
export const useChatPageNewSession = ({
  agentScope,
  sessionStoreId,
  sessionLoading,
  busyElsewhere,
  pendingSessionId,
  focusInput,
  clearInput,
  handleNewSession,
  onClearBackStack,
  onCreateNewSessionInScope,
  onNewSessionCreated,
}: Options) => {
  const pendingNewSessionFocusRef = useRef<Element | null>(null);

  const startNewSessionInScope = useCallback(async (
    targetScope: AgentScope,
    trigger: Element | null,
  ): Promise<boolean> => {
    // New chat must stay available WHILE this surface streams: the run is
    // session-anchored, so creating a session archives the running one and the
    // run keeps writing to its archived copy. Only a pointer swap
    // (sessionLoading) or another surface owning the current session
    // (busyElsewhere) blocks it.
    if (sessionLoading || busyElsewhere) return false;
    onClearBackStack?.();

    const targetStoreId = scopeSessionStoreId(targetScope);
    if (targetStoreId === sessionStoreId) {
      const result = await handleNewSession();
      if (result.ok) {
        onNewSessionCreated?.(targetScope);
        clearInput();
        restoreComposerFocusAfterRender(focusInput, trigger);
      }
      return result.ok;
    }

    if (!onCreateNewSessionInScope) return false;
    const result = await onCreateNewSessionInScope(targetScope);
    if (result.ok) {
      clearInput();
      clearChatComposerDraft(targetStoreId);
      onNewSessionCreated?.(targetScope);
      pendingNewSessionFocusRef.current = trigger;
    }
    return result.ok;
  }, [
    busyElsewhere,
    clearInput,
    focusInput,
    handleNewSession,
    onClearBackStack,
    onCreateNewSessionInScope,
    onNewSessionCreated,
    sessionLoading,
    sessionStoreId,
  ]);

  const handleNewSessionFromTopbar = useCallback(() => {
    void startNewSessionInScope({ kind: 'global' }, document.activeElement);
  }, [startNewSessionInScope]);

  const handleNewSessionFromRail = useCallback((trigger: Element | null) => {
    void startNewSessionInScope({ kind: 'global' }, trigger);
  }, [startNewSessionInScope]);

  const handleNewSessionInWorkspace = useCallback((workspaceId: string, trigger: Element | null) => {
    void startNewSessionInScope({ kind: 'workspace', workspaceId }, trigger);
  }, [startNewSessionInScope]);

  useEffect(() => {
    if (!pendingNewSessionFocusRef.current || pendingSessionId || sessionLoading) return;
    const trigger = pendingNewSessionFocusRef.current;
    pendingNewSessionFocusRef.current = null;
    restoreComposerFocusAfterRender(focusInput, trigger);
  }, [focusInput, pendingSessionId, sessionLoading]);

  return {
    handleNewSessionFromRail,
    handleNewSessionFromTopbar,
    handleNewSessionInWorkspace,
  };
};
