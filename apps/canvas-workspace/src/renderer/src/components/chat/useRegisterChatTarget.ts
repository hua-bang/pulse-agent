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
  const { insertNode, insertDomSelection, insertTab, startSkillChat, submitDomReview, focus } = handlers;
  useLayoutEffect(() => {
    if (!broker || !target) return;
    return broker.register(target, {
      insertNode,
      insertDomSelection,
      insertTab,
      startSkillChat,
      submitDomReview,
      focus,
    });
  }, [
    broker,
    focus,
    insertDomSelection,
    insertNode,
    insertTab,
    startSkillChat,
    submitDomReview,
    target,
  ]);
};
