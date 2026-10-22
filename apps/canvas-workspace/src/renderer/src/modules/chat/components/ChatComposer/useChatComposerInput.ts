import { useCallback, useEffect } from 'react';
import { isImeComposing } from '../../../../utils/ime';
import { serializeEditable } from '../../mentions/mentions';
import { insertPlainText } from '../../mentions/insertPlainText';
import { useEditableInputControl } from './useEditableInputControl';
import { useSkillMentionInsertion } from './useSkillMentionInsertion';
import { useContextMentionInsertions } from './useContextMentionInsertions';
import { useMentionItems } from './useMentionItems';
import { useMentionPopup } from './useMentionPopup';
import { useChatComposerDraft } from './useChatComposerDraft';
import { useChatComposerSubmission } from './useChatComposerSubmission';
import type { UseChatComposerInputOptions } from './types';

export function useChatComposerInput({
  allWorkspaces,
  agentScope,
  nodes,
  rootFolder,
  knowledgeTags,
  dockTabs,
  collectStructuredContext,
  onSubmit,
  onSubmitDuringRun,
  getRequestContext,
  isSubmitBlocked,
  isRunning,
}: UseChatComposerInputOptions) {
  const workspaceId = agentScope.kind === 'workspace' ? agentScope.workspaceId : undefined;
  const {
    attachmentController: chatAttachments,
    attachments,
    editableRef,
    input,
    scopeId,
    setAttachments,
    setInput,
  } = useChatComposerDraft(agentScope);
  const handleAttachFiles = useCallback((files: FileList | File[]) => {
    chatAttachments.handleAttachFiles(files);
  }, [chatAttachments.handleAttachFiles]);

  const { buildMentionItems, describeTab, searchSessionMentionItems } = useMentionItems({
    agentScope,
    allWorkspaces,
    dockTabs,
    knowledgeTags,
    nodes,
    rootFolder,
    scopeId,
    workspaceId,
  });
  const { insertFileMention, insertNodeMention, insertDomSelectionMention, insertTabMention } = useContextMentionInsertions({
    editableRef, nodes, workspaceId, setInput, describeTab,
  });
  const insertSkillMention = useSkillMentionInsertion({ editableRef, nodes, setInput });
  const {
    detectMention,
    handleMentionKeyDown,
    mentionIndex,
    mentionItems,
    mentionLoading,
    mentionOpen,
    resetMention,
    selectMention,
    setMentionIndex,
  } = useMentionPopup({ editableRef, setInput, nodes, buildMentionItems, searchSessionMentionItems });
  useEffect(() => {
    resetMention();
  }, [resetMention, scopeId]);
  const { clearInput, focusInput, replaceInput } = useEditableInputControl({
    editableRef,
    setInput,
    resetMention,
    setAttachments,
  });

  const handleInput = useCallback(() => {
    const element = editableRef.current;
    if (!element) return;
    setInput(serializeEditable(element));
    detectMention();
  }, [detectMention, setInput]);

  const {
    runInputSubmitting,
    submitCurrentInput,
    submitCurrentInputDuringRun,
  } = useChatComposerSubmission({
    attachments,
    attachmentSendBlocked: chatAttachments.sendBlocked,
    clearInput,
    collectStructuredContext,
    editableRef,
    getRequestContext,
    input,
    isSubmitBlocked,
    onSubmit,
    onSubmitDuringRun,
  });

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    // While an IME composition is active (Chinese/Japanese/Korean input),
    // Enter confirms the candidate and arrows navigate the candidate list —
    // never send the message or move the mention selection.
    if (isImeComposing(event)) return;

    if (handleMentionKeyDown(event)) return;

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!isRunning?.()) {
        void submitCurrentInput();
      } else if (!isSubmitBlocked?.()) {
        void submitCurrentInputDuringRun('follow-up');
      }
    }
  }, [
    handleMentionKeyDown,
    isRunning,
    isSubmitBlocked,
    submitCurrentInput,
    submitCurrentInputDuringRun,
  ]);

  const handlePaste = useCallback((event: React.ClipboardEvent) => {
    const imageFiles = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/'));
    if (imageFiles.length > 0) {
      event.preventDefault();
      handleAttachFiles(imageFiles);
      return;
    }
    event.preventDefault();
    insertPlainText(event.clipboardData.getData('text/plain'));
  }, [handleAttachFiles]);

  return {
    clearInput,
    attachments,
    attachmentSendBlocked: chatAttachments.sendBlocked,
    editableRef,
    focusInput,
    handleAttachFiles,
    handleInput,
    handleKeyDown,
    handlePaste,
    input,
    insertDomSelectionMention,
    insertNodeMention,
    insertSkillMention,
    insertFileMention,
    insertTabMention,
    mentionIndex,
    mentionItems,
    mentionLoading,
    mentionOpen,
    removeAttachment: chatAttachments.removeAttachment,
    retryAttachment: chatAttachments.retryAttachment,
    runInputSubmitting,
    replaceInput,
    selectMention,
    setMentionIndex,
    submitCurrentInput,
    submitCurrentInputDuringRun,
  };
}
