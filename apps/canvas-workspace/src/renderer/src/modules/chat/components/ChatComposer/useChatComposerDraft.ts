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

export const useChatComposerDraft = (agentScope: AgentScope, sessionId?: string) => {
  const scopeId = scopeSessionStoreId(agentScope);
  const draftKey = sessionId ? `${scopeId}::${sessionId}` : scopeId;
  const editableRef = useRef<HTMLDivElement>(null);
  const subscribeDraft = useCallback(
    (listener: () => void) => subscribeChatComposerDraft(draftKey, listener),
    [draftKey],
  );
  const readDraft = useCallback(() => getChatComposerDraft(draftKey), [draftKey]);
  const draft = useSyncExternalStore(subscribeDraft, readDraft, readDraft);
  const setInput = useCallback((value: string) => {
    updateChatComposerDraft(draftKey, previous => ({
      ...previous,
      input: value,
      html: editableRef.current?.innerHTML ?? previous.html,
    }));
  }, [draftKey]);
  const setAttachments = useCallback((
    value: ChatImageAttachment[] | ((previous: ChatImageAttachment[]) => ChatImageAttachment[]),
  ) => {
    updateChatComposerDraft(draftKey, previous => ({
      ...previous,
      attachments: typeof value === 'function' ? value(previous.attachments) : value,
    }));
  }, [draftKey]);
  const attachmentController = useChatAttachments({
    scopeId,
    attachments: draft.attachments,
    setAttachments,
  });

  useLayoutEffect(() => {
    const element = editableRef.current;
    if (element && element.innerHTML !== draft.html) element.innerHTML = draft.html;
  }, [draft.html, draftKey]);

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
