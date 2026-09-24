import { useCallback } from 'react';
import type {
  AgentChatMessage,
  AgentRequestContext,
  ChatImageAttachment,
} from '../../../types';
import type { ConversationKey } from '../../../../../shared/conversation-runtime';
import { readConversationSnapshot } from './conversationStore';

type SendMessage = (
  text: string,
  requestContext?: AgentRequestContext,
  attachments?: ChatImageAttachment[],
  truncateAt?: number,
) => Promise<boolean>;

/** The user turn an assistant (or stopped/failed) message answered. */
export function findAnsweredUserIndex(messages: AgentChatMessage[], index: number): number {
  for (let cursor = Math.min(index, messages.length - 1); cursor >= 0; cursor -= 1) {
    if (messages[cursor]?.role === 'user') return cursor;
  }
  return -1;
}

/**
 * Edit and regenerate replace a user turn in the same conversation: the
 * runtime drops history from that turn and runs it again, keeping the
 * turn's attachments. No branch or pointer change is involved.
 */
export function useConversationRecovery(key: ConversationKey, sendMessage: SendMessage) {
  const editUserMessage = useCallback((
    index: number,
    newContent: string,
    requestContext?: AgentRequestContext,
  ): Promise<boolean> => {
    const source = readConversationSnapshot(key).messages[index];
    if (source?.role !== 'user' || !newContent.trim()) return Promise.resolve(false);
    return sendMessage(newContent, requestContext, source.attachments ?? [], index);
  }, [key, sendMessage]);

  const regenerateAssistantMessage = useCallback((
    index: number,
    requestContext?: AgentRequestContext,
  ): Promise<boolean> => {
    const messages = readConversationSnapshot(key).messages;
    const userIndex = findAnsweredUserIndex(messages, index);
    const source = messages[userIndex];
    if (!source) return Promise.resolve(false);
    return sendMessage(source.content, requestContext, source.attachments ?? [], userIndex);
  }, [key, sendMessage]);

  return { editUserMessage, regenerateAssistantMessage };
}
