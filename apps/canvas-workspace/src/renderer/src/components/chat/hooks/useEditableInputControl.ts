import { useCallback, type MutableRefObject, type RefObject } from 'react';
import type { ChatImageAttachment, MentionItem } from '../types';

interface Options {
  editableRef: RefObject<HTMLDivElement>;
  mentionBuildSeqRef: MutableRefObject<number>;
  setInput: (value: string) => void;
  setMentionOpen: (value: boolean) => void;
  setMentionItems: (value: MentionItem[]) => void;
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
  setMentionIndex,
  setAttachments,
}: Options) => {
  const clearInput = useCallback(() => {
    setInput('');
    mentionBuildSeqRef.current++;
    setMentionOpen(false);
    setMentionItems([]);
    setMentionIndex(0);
    setAttachments([]);
    if (editableRef.current) editableRef.current.innerHTML = '';
  }, [editableRef, mentionBuildSeqRef, setAttachments, setInput, setMentionIndex, setMentionItems, setMentionOpen]);

  const focusInput = useCallback(() => {
    editableRef.current?.focus();
  }, [editableRef]);

  const replaceInput = useCallback((text: string) => {
    mentionBuildSeqRef.current++;
    setMentionOpen(false);
    setMentionItems([]);
    setMentionIndex(0);
    setInput(text);
    const element = editableRef.current;
    if (!element) return;
    element.textContent = text;
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [editableRef, mentionBuildSeqRef, setInput, setMentionIndex, setMentionItems, setMentionOpen]);

  return { clearInput, focusInput, replaceInput };
};
