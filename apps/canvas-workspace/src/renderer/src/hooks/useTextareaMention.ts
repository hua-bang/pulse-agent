import { useCallback, useState, type KeyboardEvent, type RefObject } from 'react';
import type { CanvasNode } from '../types';
import { buildNodeMentionInsertion } from '../utils/nodeMention';

interface Options {
  textareaRef: RefObject<HTMLTextAreaElement>;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/**
 * Adds canvas "@" mention support to a plain <textarea>.
 *
 * The Terminal and the running Agent terminal open the NodeMentionPicker via
 * xterm's custom key handler and write the mention straight to the PTY. Plain
 * textareas (the Coding Agent setup prompt, the Agent Teams Team Lead brief)
 * have no PTY, so this hook wires the same Ctrl/Cmd+2 picker to instead insert
 * the mention text at the caret and keep the caret after it.
 */
export function useTextareaMention({ textareaRef, value, onChange, disabled }: Options) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent): boolean => {
      if (disabled) return false;
      if (event.key === '2' && (event.metaKey || event.ctrlKey) && !event.altKey) {
        event.preventDefault();
        setPickerOpen(true);
        return true;
      }
      return false;
    },
    [disabled],
  );

  const handleSelect = useCallback(
    (node: CanvasNode) => {
      setPickerOpen(false);
      if (disabled) return;
      const textarea = textareaRef.current;
      const start = textarea?.selectionStart ?? value.length;
      const end = textarea?.selectionEnd ?? value.length;
      const mention = buildNodeMentionInsertion(node, {
        before: value.slice(0, start),
        after: value.slice(end),
      });
      const next = `${value.slice(0, start)}${mention}${value.slice(end)}`;
      onChange(next);
      const caret = start + mention.length;
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(caret, caret);
      });
    },
    [disabled, onChange, textareaRef, value],
  );

  const handleClose = useCallback(() => {
    setPickerOpen(false);
    textareaRef.current?.focus();
  }, [textareaRef]);

  return { pickerOpen, handleKeyDown, handleSelect, handleClose };
}
