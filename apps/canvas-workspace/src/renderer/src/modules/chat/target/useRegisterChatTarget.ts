import { useLayoutEffect } from 'react';
import {
  useOptionalChatTargetBroker,
  type ChatTarget,
  type ChatTargetHandlers,
} from './index';

export const useRegisterChatTarget = (
  target: ChatTarget | null,
  handlers: ChatTargetHandlers,
): void => {
  const broker = useOptionalChatTargetBroker();
  const { insertFile, insertNode, insertDomSelection, insertTab, startSkillChat, submitDomReview, submitPrompt, focus } = handlers;
  useLayoutEffect(() => {
    if (!broker || !target) return;
    return broker.register(target, {
      insertFile,
      insertNode,
      insertDomSelection,
      insertTab,
      startSkillChat,
      submitDomReview,
      submitPrompt,
      focus,
    });
  }, [
    broker,
    focus,
    insertDomSelection,
    insertFile,
    insertNode,
    insertTab,
    startSkillChat,
    submitDomReview,
    submitPrompt,
    target,
  ]);
};
