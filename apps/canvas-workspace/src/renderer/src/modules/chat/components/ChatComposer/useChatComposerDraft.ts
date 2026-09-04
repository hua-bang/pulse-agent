import {
  useCallback,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from 'react';
import type { AgentScope, ChatImageAttachment } from '../../../../types';
import { scopeSessionStoreId } from '../../../../../../shared/agent-chat';
import {
  getChatComposerDraft,
  subscribeChatComposerDraft,
  updateChatComposerDraft,
} from '../../composer/chatComposerDraftStore';
import { useChatAttachments } from '../../attachments/useChatAttachments';

export const useChatComposerDraft = (agentScope: AgentScope) => {
  const scopeId = scopeSessionStoreId(agentScope);
  const editableRef = useRef<HTMLDivElement>(null);
  const subscribeDraft = useCallback(
    (listener: () => void) => subscribeChatComposerDraft(scopeId, listener),
    [scopeId],
  );
  const readDraft = useCallback(() => getChatComposerDraft(scopeId), [scopeId]);
  const draft = useSyncExternalStore(subscribeDraft, readDraft, readDraft);
  const setInput = useCallback((value: string) => {
    updateChatComposerDraft(scopeId, previous => ({
      ...previous,
      input: value,
      html: editableRef.current?.innerHTML ?? previous.html,
    }));
  }, [scopeId]);
  const setAttachments = useCallback((
    value: ChatImageAttachment[] | ((previous: ChatImageAttachment[]) => ChatImageAttachment[]),
  ) => {
    updateChatComposerDraft(scopeId, previous => ({
      ...previous,
      attachments: typeof value === 'function' ? value(previous.attachments) : value,
    }));
  }, [scopeId]);
  const attachmentController = useChatAttachments({
    scopeId,
    attachments: draft.attachments,
    setAttachments,
  });

  useLayoutEffect(() => {
    const element = editableRef.current;
    if (element && element.innerHTML !== draft.html) element.innerHTML = draft.html;
  }, [draft.html, scopeId]);

  return {
    attachmentController,
    attachments: draft.attachments,
    editableRef,
    input: draft.input,
    scopeId,
    setAttachments,
    setInput,
  };
};
