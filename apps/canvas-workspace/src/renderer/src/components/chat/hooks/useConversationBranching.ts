import { useCallback, useState } from 'react';

import type {
  AgentChatMessage,
  AgentRequestContext,
  AgentScope,
  ChatImageAttachment,
} from '../../../types';
import { requestContextFromSnapshot } from './turnContextSnapshot';
import { useI18n } from '../../../i18n';

interface ConversationBranch {
  sourceSessionId: string;
  activeSessionId: string;
}

interface UseConversationBranchingOptions {
  agentScope: AgentScope;
  loading: boolean;
  messages: AgentChatMessage[];
  replaceMessages: (messages: AgentChatMessage[]) => void;
  sendMessage: (
    text: string,
    requestContext?: AgentRequestContext,
    attachments?: ChatImageAttachment[],
  ) => Promise<boolean>;
  onActiveSessionChange?: (sessionId: string) => void;
}

export function useConversationBranching({
  agentScope,
  loading,
  messages,
  replaceMessages,
  sendMessage,
  onActiveSessionChange,
}: UseConversationBranchingOptions) {
  const { t } = useI18n();
  const [conversationBranch, setConversationBranch] = useState<ConversationBranch | null>(null);
  const [branchError, setBranchError] = useState<string | null>(null);

  const createBranch = useCallback(async (fromIndex: number): Promise<boolean> => {
    if (loading || fromIndex < 0) return false;
    setBranchError(null);
    try {
      const result = await window.canvasWorkspace.agent.branchSession(
        { scope: agentScope },
        fromIndex,
      );
      if (
        !result.ok
        || !result.sourceSessionId
        || !result.activeSessionId
        || !result.messages
      ) {
        setBranchError(result.error ?? t('chat.branchCreateFailed'));
        return false;
      }
      // Main is authoritative: update the visible thread only after the new
      // branch is durable and active.
      replaceMessages(result.messages);
      setConversationBranch({
        sourceSessionId: result.sourceSessionId,
        activeSessionId: result.activeSessionId,
      });
      onActiveSessionChange?.(result.activeSessionId);
      return true;
    } catch (error) {
      setBranchError(error instanceof Error ? error.message : String(error));
      return false;
    }
  }, [agentScope, loading, onActiveSessionChange, replaceMessages, t]);

  const editUserMessage = useCallback(async (
    userIndex: number,
    newContent: string,
    requestContext?: AgentRequestContext,
  ): Promise<boolean> => {
    const trimmed = newContent.trim();
    if (!trimmed || loading) return false;
    const original = messages[userIndex];
    if (!original || original.role !== 'user') return false;
    if (!await createBranch(userIndex)) return false;
    const originalContext = original.contextSnapshot
      ? requestContextFromSnapshot(original.contextSnapshot)
      : requestContext;
    return sendMessage(trimmed, originalContext, original.attachments ?? []);
  }, [createBranch, loading, messages, sendMessage]);

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
    if (!await createBranch(userIndex)) return false;
    const originalContext = userMessage.contextSnapshot
      ? requestContextFromSnapshot(userMessage.contextSnapshot)
      : requestContext;
    return sendMessage(
      userMessage.content,
      originalContext,
      userMessage.attachments ?? [],
    );
  }, [createBranch, loading, messages, sendMessage]);

  const undoConversationBranch = useCallback(async (): Promise<boolean> => {
    const branch = conversationBranch;
    if (!branch || loading) return false;
    setBranchError(null);
    try {
      const result = await window.canvasWorkspace.agent.loadSession(
        { scope: agentScope },
        branch.sourceSessionId,
      );
      if (!result.ok || result.activeSessionId !== branch.sourceSessionId || !result.messages) {
        setBranchError(result.error ?? t('chat.branchRestoreFailed'));
        return false;
      }
      replaceMessages(result.messages);
      onActiveSessionChange?.(branch.sourceSessionId);
      setConversationBranch(null);
      return true;
    } catch (error) {
      setBranchError(error instanceof Error ? error.message : String(error));
      return false;
    }
  }, [agentScope, conversationBranch, loading, onActiveSessionChange, replaceMessages, t]);

  return {
    branchError,
    conversationBranch,
    editUserMessage,
    regenerateAssistantMessage,
    undoConversationBranch,
  };
}
