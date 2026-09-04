import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { MentionItem } from '../../../../types';
import { isImeComposing } from '../../../../utils/ime';
import { createMentionChipElement, serializeEditable } from '../utils/mentions';
import { useEditableInputControl } from './useEditableInputControl';
import { useSkillMentionInsertion } from './useSkillMentionInsertion';
import { useContextMentionInsertions } from './useContextMentionInsertions';
import { useMentionItems } from './useMentionItems';
import { useChatComposerDraft } from './useChatComposerDraft';
import { useChatComposerSubmission } from './useChatComposerSubmission';
import type { UseChatComposerInputOptions } from './types';

export function useChatComposerInput({
  allWorkspaces,
  agentScope,
  nodes,
  rootFolder,
  knowledgeNodes,
  knowledgeTags,
  dockTabs,
  collectStructuredContext,
  onSubmit,
  onSubmitDuringRun,
  getRequestContext,
  isSubmitBlocked,
}: UseChatComposerInputOptions) {
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionItems, setMentionItems] = useState<MentionItem[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
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

  useEffect(() => {
    mentionBuildSeqRef.current++;
    setMentionOpen(false);
    setMentionItems([]);
    setMentionIndex(0);
  }, [scopeId]);
  /** Trigger whose query selectMention must replace. */
  const mentionTriggerRef = useRef<'@' | '/'>('@');
  /** Prevents stale async popup builds from repainting or reopening. */
  const mentionBuildSeqRef = useRef(0);

  const { buildMentionItems, describeTab } = useMentionItems({
    agentScope,
    allWorkspaces,
    dockTabs,
    knowledgeNodes,
    knowledgeTags,
    nodes,
    rootFolder,
    scopeId,
    workspaceId,
  });
  const { insertNodeMention, insertDomSelectionMention, insertTabMention } = useContextMentionInsertions({
    editableRef, nodes, workspaceId, setInput, describeTab,
  });
  const insertSkillMention = useSkillMentionInsertion({ editableRef, nodes, setInput });
  const { clearInput, focusInput, replaceInput } = useEditableInputControl({
    editableRef,
    mentionBuildSeqRef,
    setInput,
    setMentionOpen,
    setMentionItems,
    setMentionIndex,
    setAttachments,
  });

  const handleInput = useCallback(() => {
    const element = editableRef.current;
    if (!element) return;

    setInput(serializeEditable(element));

    // Every input event supersedes any in-flight popup build.
    const buildSeq = ++mentionBuildSeqRef.current;

    const selection = window.getSelection();
    if (
      !selection
      || !selection.rangeCount
      || !selection.anchorNode
      || selection.anchorNode.nodeType !== Node.TEXT_NODE
    ) {
      setMentionOpen(false);
      return;
    }

    const textBeforeCursor = (selection.anchorNode.textContent ?? '').slice(0, selection.anchorOffset);
    // Trigger on @ (mentions: workspaces/nodes/files) or / (skills). We pick
    // whichever marker is closer to the cursor so typing "/foo @bar" still
    // opens the @-popup once the user is past the slash query.
    const atMatch = textBeforeCursor.match(/@([^\s@/]*)$/);
    const slashMatch = textBeforeCursor.match(/(?:^|\s)\/([^\s@/]*)$/);
    const match = atMatch && slashMatch
      ? (atMatch.index! >= slashMatch.index! ? atMatch : slashMatch)
      : atMatch ?? slashMatch;

    if (!match) {
      setMentionOpen(false);
      return;
    }

    const trigger: '@' | '/' = match === atMatch ? '@' : '/';
    mentionTriggerRef.current = trigger;

    setMentionIndex(0);
    void buildMentionItems(match[1], trigger).then(items => {
      if (buildSeq !== mentionBuildSeqRef.current) return;
      setMentionItems(items);
      setMentionOpen(items.length > 0);
    });
  }, [buildMentionItems]);

  // Dismiss when focus moves outside the composer/popup.
  useEffect(() => {
    if (!mentionOpen) return;
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (editableRef.current?.contains(target)) return;
      if (target.closest('.chat-mention-popup')) return;
      mentionBuildSeqRef.current++;
      setMentionOpen(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [mentionOpen]);

  const selectMention = useCallback((item: MentionItem) => {
    const element = editableRef.current;
    if (!element) return;

    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;

    const { anchorNode, anchorOffset } = selection;
    if (!anchorNode || anchorNode.nodeType !== Node.TEXT_NODE) return;

    const text = anchorNode.textContent ?? '';
    const before = text.slice(0, anchorOffset);
    const trigger = mentionTriggerRef.current;
    const triggerIndex = before.lastIndexOf(trigger);
    if (triggerIndex < 0) return;

    const beforeAt = text.slice(0, triggerIndex);
    const afterCursor = text.slice(anchorOffset);
    const chip = createMentionChipElement(item, nodes);
    const parent = anchorNode.parentNode;

    if (!parent) return;

    const fragment = document.createDocumentFragment();
    if (beforeAt) fragment.appendChild(document.createTextNode(beforeAt));
    fragment.appendChild(chip);

    const spaceNode = document.createTextNode(' ');
    fragment.appendChild(spaceNode);

    if (afterCursor) fragment.appendChild(document.createTextNode(afterCursor));
    parent.replaceChild(fragment, anchorNode);

    const range = document.createRange();
    range.setStartAfter(spaceNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    setInput(serializeEditable(element));
    mentionBuildSeqRef.current++;
    setMentionOpen(false);
    element.focus();
  }, [nodes]);

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

    if (mentionOpen && mentionItems.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setMentionIndex(index => (index + 1) % mentionItems.length);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setMentionIndex(index => (index - 1 + mentionItems.length) % mentionItems.length);
        return;
      }

      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        selectMention(mentionItems[mentionIndex]);
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        mentionBuildSeqRef.current++;
        setMentionOpen(false);
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submitCurrentInput();
    }
  }, [mentionIndex, mentionItems, mentionOpen, selectMention, submitCurrentInput]);

  const handlePaste = useCallback((event: React.ClipboardEvent) => {
    const imageFiles = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/'));
    if (imageFiles.length > 0) {
      event.preventDefault();
      handleAttachFiles(imageFiles);
      return;
    }
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
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
    insertTabMention,
    mentionIndex,
    mentionItems,
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
