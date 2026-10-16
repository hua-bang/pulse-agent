import { useCallback, type RefObject } from 'react';
import type { ChatImageAttachment } from '../../../../types';

interface Options {
  editableRef: RefObject<HTMLDivElement>;
  setInput: (value: string) => void;
  /** Closes the mention popup and drops its rows. */
  resetMention: () => void;
  setAttachments: (value: ChatImageAttachment[]) => void;
}

/** Imperative composition input operations shared by mention and route flows. */
export const useEditableInputControl = ({
  editableRef,
  setInput,
  resetMention,
  setAttachments,
}: Options) => {
  const clearInput = useCallback(() => {
    if (editableRef.current) editableRef.current.innerHTML = '';
    setInput('');
    resetMention();
    setAttachments([]);
  }, [editableRef, resetMention, setAttachments, setInput]);

  const focusInput = useCallback(() => {
    editableRef.current?.focus();
  }, [editableRef]);

  const replaceInput = useCallback((text: string) => {
    resetMention();
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
  }, [editableRef, resetMention, setInput]);

  return { clearInput, focusInput, replaceInput };
};
