import type { MutableRefObject } from 'react';

export interface ChatConversationMutationState {
  generation: number;
  busy: boolean;
}

export type ChatConversationMutationRef = MutableRefObject<ChatConversationMutationState>;

export const createChatConversationMutationState = (): ChatConversationMutationState => ({
  generation: 0,
  busy: false,
});

/** Starts a newer conversation-pointer intent and retires every older one. */
export function beginChatConversationMutation(
  ref: ChatConversationMutationRef,
  onBegin?: () => void,
): number {
  const generation = ref.current.generation + 1;
  ref.current = { generation, busy: true };
  onBegin?.();
  return generation;
}

/** Clears busy only when the finishing operation still owns the generation. */
export function finishChatConversationMutation(
  ref: ChatConversationMutationRef,
  generation: number,
): void {
  if (ref.current.generation !== generation) return;
  ref.current = { generation, busy: false };
}

export function invalidateChatConversationMutation(ref: ChatConversationMutationRef): void {
  ref.current = {
    generation: ref.current.generation + 1,
    busy: false,
  };
}

export const isCurrentChatConversationMutation = (
  ref: ChatConversationMutationRef,
  generation: number,
): boolean => ref.current.generation === generation;

/** Captures every pointer that makes an async chat callback safe to publish. */
export function createChatConversationGuard(
  scopeEpochRef: MutableRefObject<number>,
  conversationEpochRef?: MutableRefObject<number>,
  mutationRef?: ChatConversationMutationRef,
  isTurnCurrent?: () => boolean,
) {
  const scopeEpoch = scopeEpochRef.current;
  const conversationEpoch = conversationEpochRef?.current;
  const mutationGeneration = mutationRef?.current.generation;
  const isCurrent = () => (
    scopeEpochRef.current === scopeEpoch
    && conversationEpochRef?.current === conversationEpoch
    && mutationRef?.current.generation === mutationGeneration
    && (isTurnCurrent?.() ?? true)
  );
  const guard = <Args extends unknown[]>(handler: (...args: Args) => void) => (
    ...args: Args
  ) => {
    if (isCurrent()) handler(...args);
  };
  return { isCurrent, guard };
}
