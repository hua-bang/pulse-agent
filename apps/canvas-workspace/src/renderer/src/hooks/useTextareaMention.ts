import { useCallback, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import type { CanvasNode } from '../types';
import { buildNodeMentionInsertion } from '../utils/nodeMention';
import { isImeComposing } from '../utils/ime';

interface Options {
  textareaRef: RefObject<HTMLTextAreaElement>;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/**
 * Adds canvas "@" mention support to a plain <textarea>.
 *
 * Two ways to open the picker:
 * - Type `@` at a word boundary (start of input or after whitespace). The `@`
 *   is left in place while the picker is open and consumed when a node is
 *   picked, so the caret text reads `… @[label](canvas:id) …`. Dismissing the
 *   picker keeps the literal `@` (the user may have meant an address/handle).
 * - Press Ctrl/Cmd+2 — inserts the mention at the current caret.
 *
 * The Terminal and the running Agent terminal can't intercept `@` (xterm
 * forwards it straight to the PTY, where `@` is a common character), so they
 * keep the Ctrl/Cmd+2 shortcut and a persistent trigger button instead.
 */
export function useTextareaMention({ textareaRef, value, onChange, disabled }: Options) {
  const [pickerOpen, setPickerOpen] = useState(false);
  // Index of the literal `@` that opened the picker via the inline trigger, or
  // null when opened via Ctrl/Cmd+2 (insert at the caret instead).
  const atIndexRef = useRef<number | null>(null);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent): boolean => {
      if (disabled) return false;
      if (isImeComposing(event)) return false;
      // Ctrl/Cmd+2 — insert the mention at the caret.
      if (event.key === '2' && (event.metaKey || event.ctrlKey) && !event.altKey) {
        event.preventDefault();
        atIndexRef.current = null;
        setPickerOpen(true);
        return true;
      }
      // Inline `@` trigger at a word boundary. Let the `@` type normally; it is
      // consumed when a node is picked.
      if (event.key === '@' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const caret = textareaRef.current?.selectionStart ?? value.length;
        const prev = caret > 0 ? value[caret - 1] : '';
        if (caret === 0 || /\s/.test(prev)) {
          atIndexRef.current = caret;
          setPickerOpen(true);
        }
        return false;
      }
      return false;
    },
    [disabled, textareaRef, value],
  );

  const handleSelect = useCallback(
    (node: CanvasNode) => {
      setPickerOpen(false);
      if (disabled) return;
      const textarea = textareaRef.current;
      const atIndex = atIndexRef.current;
      atIndexRef.current = null;

      // Inline `@` trigger: replace the literal `@` at atIndex with the mention.
      // Otherwise (Ctrl/Cmd+2) insert at the current selection.
      const start = atIndex ?? textarea?.selectionStart ?? value.length;
      const end = atIndex !== null ? atIndex + 1 : textarea?.selectionEnd ?? value.length;
      const before = value.slice(0, start);
      const after = value.slice(end);
      const mention = buildNodeMentionInsertion(node, { before, after });
      onChange(`${before}${mention}${after}`);
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
    atIndexRef.current = null;
    textareaRef.current?.focus();
  }, [textareaRef]);

  return { pickerOpen, handleKeyDown, handleSelect, handleClose };
}
