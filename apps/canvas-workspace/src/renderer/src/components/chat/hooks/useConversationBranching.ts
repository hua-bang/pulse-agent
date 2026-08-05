import { useCallback, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';

import type {
  AgentChatMessage,
  AgentRequestContext,
  AgentScope,
  ChatImageAttachment,
} from '../../../types';
import { requestContextFromSnapshot } from './turnContextSnapshot';
import { useI18n } from '../../../i18n';
import { chatScopeId } from '../chatScope';
import {
  beginChatConversationMutation,
  createChatConversationMutationState,
  finishChatConversationMutation,
  isCurrentChatConversationMutation,
  type ChatConversationMutationRef,
} from './chatConversationMutation';

interface UseConversationBranchingOptions {
  agentScope: AgentScope;
  loading: boolean;
  messages: AgentChatMessage[];
  replaceMessages: (messages: AgentChatMessage[]) => void;
  sendMessageForMutation: (
    mutationGeneration: number,
    text: string,
    requestContext?: AgentRequestContext,
    attachments?: ChatImageAttachment[],
  ) => Promise<boolean>;
  onActiveSessionChange?: (sessionId: string) => void;
  onConversationMutationStart?: () => void;
  conversationEpochRef?: MutableRefObject<number>;
  conversationMutationRef?: ChatConversationMutationRef;
}

export function useConversationBranching({
  agentScope,
  loading,
  messages,
  replaceMessages,
  sendMessageForMutation,
  onActiveSessionChange,
  onConversationMutationStart,
  conversationEpochRef,
  conversationMutationRef,
}: UseConversationBranchingOptions) {
  const { t } = useI18n();
  const [conversationError, setConversationError] = useState<string | null>(null);
  const scopeId = chatScopeId(agentScope);
  const previousScopeIdRef = useRef(scopeId);
  const scopeEpochRef = useRef(0);
  const localConversationMutationRef = useRef(createChatConversationMutationState());
  const mutationRef = conversationMutationRef ?? localConversationMutationRef;

  useLayoutEffect(() => {
    if (previousScopeIdRef.current === scopeId) return;
    previousScopeIdRef.current = scopeId;
    scopeEpochRef.current += 1;
  }, [scopeId]);

  const runBranchMutation = useCallback(async (
    fromIndex: number,
    sendReplacement: (mutationGeneration: number) => Promise<boolean>,
  ): Promise<boolean> => {
    if (loading || fromIndex < 0 || mutationRef.current.busy) return false;
    const branchMutationGeneration = beginChatConversationMutation(mutationRef, onConversationMutationStart);
    const branchConversationEpoch = conversationEpochRef?.current;
    const branchScopeEpoch = scopeEpochRef.current;
    const isCurrentMutation = () => (
      isCurrentChatConversationMutation(mutationRef, branchMutationGeneration)
      && conversationEpochRef?.current === branchConversationEpoch
      && scopeEpochRef.current === branchScopeEpoch
    );
    setConversationError(null);
    try {
      const result = await window.canvasWorkspace.agent.branchSession(
        { scope: agentScope },
        fromIndex,
      );
      if (!isCurrentMutation()) return false;
      if (
        !result.ok
        || !result.sourceSessionId
        || !result.activeSessionId
        || !result.messages
      ) {
        setConversationError(result.error ?? t('chat.sessionUpdateFailed'));
        return false;
      }
      // Main is authoritative: update the visible thread only after the new
      // branch is durable and active.
      replaceMessages(result.messages);
      onActiveSessionChange?.(result.activeSessionId);
      return await sendReplacement(branchMutationGeneration);
    } catch (error) {
      if (!isCurrentMutation()) return false;
      setConversationError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      finishChatConversationMutation(mutationRef, branchMutationGeneration);
    }
  }, [agentScope, conversationEpochRef, loading, mutationRef, onActiveSessionChange, onConversationMutationStart, replaceMessages, t]);

  const editUserMessage = useCallback(async (
    userIndex: number,
    newContent: string,
    requestContext?: AgentRequestContext,
  ): Promise<boolean> => {
    const trimmed = newContent.trim();
    if (!trimmed || loading) return false;
    const original = messages[userIndex];
    if (!original || original.role !== 'user') return false;
    const originalContext = original.contextSnapshot
      ? requestContextFromSnapshot(original.contextSnapshot)
      : requestContext;
    return runBranchMutation(
      userIndex,
      mutationGeneration => sendMessageForMutation(
        mutationGeneration,
        trimmed,
        originalContext,
        original.attachments ?? [],
      ),
    );
  }, [loading, messages, runBranchMutation, sendMessageForMutation]);

  const regenerateAssistantMessage = useCallback(async (
    assistantIndex: number,
    requestContext?: AgentRequestContext,
  ): Promise<boolean> => {
    if (loading) return false;
    const assistant = messages[assistantIndex];
    if (!assistant || assistant.role !== 'assistant') return false;
    let userIndex = assistantIndex - 1;
    while (userIndex >= 0 && messages[userIndex].role !== 'user') userIndex--;
    if (userIndex < 0) return false;
    const userMessage = messages[userIndex];
    const originalContext = userMessage.contextSnapshot
      ? requestContextFromSnapshot(userMessage.contextSnapshot)
      : requestContext;
    return runBranchMutation(
      userIndex,
      mutationGeneration => sendMessageForMutation(
        mutationGeneration,
        userMessage.content,
        originalContext,
        userMessage.attachments ?? [],
      ),
    );
  }, [loading, messages, runBranchMutation, sendMessageForMutation]);

  return {
    conversationError,
    editUserMessage,
    regenerateAssistantMessage,
  };
}
