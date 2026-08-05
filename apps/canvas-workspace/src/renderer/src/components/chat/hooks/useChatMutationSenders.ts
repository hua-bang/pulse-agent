import { useCallback } from 'react';

import type { AgentRequestContext, ChatImageAttachment } from '../../../types';
import type { ChatConversationMutationRef } from './chatConversationMutation';

type ChatSendMessage = (
  text: string,
  requestContext?: AgentRequestContext,
  attachments?: ChatImageAttachment[],
) => Promise<boolean>;

/** Keeps the public sender closed while allowing the owning branch replacement through. */
export function useChatMutationSenders(
  sendMessageInternal: ChatSendMessage,
  mutationRef?: ChatConversationMutationRef,
) {
  const send = useCallback((
    allowedGeneration: number | undefined,
    args: Parameters<ChatSendMessage>,
  ) => {
    const mutation = mutationRef?.current;
    return mutation?.busy && mutation.generation !== allowedGeneration
      ? Promise.resolve(false)
      : sendMessageInternal(...args);
  }, [mutationRef, sendMessageInternal]);

  const sendMessage = useCallback(
    (...args: Parameters<ChatSendMessage>) => send(undefined, args),
    [send],
  );
  const sendMessageForMutation = useCallback((
    generation: number,
    ...args: Parameters<ChatSendMessage>
  ) => send(generation, args), [send]);

  return { sendMessage, sendMessageForMutation };
}
