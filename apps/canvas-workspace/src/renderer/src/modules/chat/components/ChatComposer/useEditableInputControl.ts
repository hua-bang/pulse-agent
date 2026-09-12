import { useCallback, type MutableRefObject, type RefObject } from 'react';
import type { ChatImageAttachment, MentionItem } from '../../../../types';

interface Options {
  editableRef: RefObject<HTMLDivElement>;
  mentionBuildSeqRef: MutableRefObject<number>;
  setInput: (value: string) => void;
  setMentionOpen: (value: boolean) => void;
  setMentionItems: (value: MentionItem[]) => void;
  setMentionLoading: (value: boolean) => void;
  setMentionIndex: (value: number) => void;
  setAttachments: (value: ChatImageAttachment[]) => void;
}

/** Imperative composition input operations shared by mention and route flows. */
export const useEditableInputControl = ({
  editableRef,
  mentionBuildSeqRef,
  setInput,
  setMentionOpen,
  setMentionItems,
  setMentionLoading,
  setMentionIndex,
  setAttachments,
}: Options) => {
  const clearInput = useCallback(() => {
    if (editableRef.current) editableRef.current.innerHTML = '';
    setInput('');
    mentionBuildSeqRef.current++;
    setMentionOpen(false);
    setMentionItems([]);
    setMentionLoading(false);
    setMentionIndex(0);
    setAttachments([]);
  }, [editableRef, mentionBuildSeqRef, setAttachments, setInput, setMentionIndex, setMentionItems, setMentionLoading, setMentionOpen]);

  const focusInput = useCallback(() => {
    editableRef.current?.focus();
  }, [editableRef]);

  const replaceInput = useCallback((text: string) => {
    mentionBuildSeqRef.current++;
    setMentionOpen(false);
    setMentionItems([]);
    setMentionLoading(false);
    setMentionIndex(0);
    const element = editableRef.current;
    if (element) element.textContent = text;
    setInput(text);
    if (!element) return;
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [editableRef, mentionBuildSeqRef, setInput, setMentionIndex, setMentionItems, setMentionLoading, setMentionOpen]);

  return { clearInput, focusInput, replaceInput };
};
