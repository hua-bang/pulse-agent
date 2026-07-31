import { useLayoutEffect } from 'react';
import {
  useOptionalChatTargetBroker,
  type ChatTarget,
  type ChatTargetHandlers,
} from './ChatTargetContext';

export const useRegisterChatTarget = (
  target: ChatTarget | null,
  handlers: ChatTargetHandlers,
): void => {
  const broker = useOptionalChatTargetBroker();
  const { insertNode, insertDomSelection, startSkillChat, submitDomReview, focus } = handlers;
  useLayoutEffect(() => {
    if (!broker || !target) return;
    return broker.register(target, {
      insertNode,
      insertDomSelection,
      startSkillChat,
      submitDomReview,
      focus,
    });
  }, [
    broker,
    focus,
    insertDomSelection,
    insertNode,
    startSkillChat,
    submitDomReview,
    target,
  ]);
};
