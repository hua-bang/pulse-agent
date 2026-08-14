import { useCallback, useEffect, useRef, useState } from 'react';
import { scopeSessionStoreId } from '../../../../../shared/agent-chat';
import type { AgentNewSessionResult, AgentScope } from '../types';
import { clearChatComposerDraft } from './chatComposerDraftStore';
import { restoreComposerFocusAfterRender } from '../utils/focusRecovery';

interface Options {
  agentScope: AgentScope;
  sessionStoreId: string;
  loading: boolean;
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
  loading,
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
  const [newSessionPickerOpen, setNewSessionPickerOpen] = useState(false);
  const newSessionTriggerRef = useRef<Element | null>(null);
  const pendingNewSessionFocusRef = useRef<Element | null>(null);

  const closeNewSessionPicker = useCallback(() => {
    setNewSessionPickerOpen(false);
    newSessionTriggerRef.current = null;
  }, []);

  const startNewSessionInScope = useCallback(async (
    targetScope: AgentScope,
    trigger: Element | null,
  ): Promise<boolean> => {
    if (loading || sessionLoading || busyElsewhere) return false;
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
    loading,
    onClearBackStack,
    onCreateNewSessionInScope,
    onNewSessionCreated,
    sessionLoading,
    sessionStoreId,
  ]);

  const openNewSessionPicker = useCallback((trigger: Element | null) => {
    if (loading || sessionLoading || busyElsewhere) return;
    newSessionTriggerRef.current = trigger;
    setNewSessionPickerOpen(true);
  }, [busyElsewhere, loading, sessionLoading]);

  const handleNewSessionFromTopbar = useCallback(() => {
    if (loading || sessionLoading || busyElsewhere) return;
    const trigger = document.activeElement;
    // The top-right plus is the fast path: once a workspace is active, keep
    // the new conversation in that workspace. Global Chat and scheduled
    // views ask for a workspace or Global Chat destination explicitly.
    if (agentScope.kind === 'workspace') {
      void startNewSessionInScope(agentScope, trigger);
      return;
    }
    openNewSessionPicker(trigger);
  }, [agentScope, busyElsewhere, loading, openNewSessionPicker, sessionLoading, startNewSessionInScope]);

  const handleNewSessionDestination = useCallback(async (targetScope: AgentScope) => {
    const success = await startNewSessionInScope(targetScope, newSessionTriggerRef.current);
    if (success) newSessionTriggerRef.current = null;
    return success;
  }, [startNewSessionInScope]);

  useEffect(() => {
    if (!pendingNewSessionFocusRef.current || pendingSessionId || sessionLoading) return;
    const trigger = pendingNewSessionFocusRef.current;
    pendingNewSessionFocusRef.current = null;
    restoreComposerFocusAfterRender(focusInput, trigger);
  }, [focusInput, pendingSessionId, sessionLoading]);

  return {
    closeNewSessionPicker,
    handleNewSessionDestination,
    handleNewSessionFromTopbar,
    newSessionPickerOpen,
    openNewSessionPicker,
  };
};
