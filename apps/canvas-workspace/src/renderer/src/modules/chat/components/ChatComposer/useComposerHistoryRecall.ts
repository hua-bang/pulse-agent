import { useCallback, useRef, type KeyboardEvent, type RefObject } from 'react';
import { serializeEditable } from '../../mentions/mentions';

interface Options {
  editableRef: RefObject<HTMLDivElement>;
  /** User messages of the open conversation, oldest first. */
  getUserMessages?: () => string[];
  /** Replace the whole draft and put the caret at its end. */
  replaceInput: (text: string) => void;
}

interface RecallState {
  /** Position in the user-message list, counted from the newest (0). */
  index: number;
  /** The text the composer showed after the last recall step. */
  text: string;
}

type CaretEdge = 'start' | 'end';

/**
 * True when no line break separates the caret from the given edge of the
 * draft, so ArrowUp/ArrowDown would leave the editable instead of moving
 * between lines of a recalled multi-line message.
 */
const caretOnEdgeLine = (element: HTMLElement, edge: CaretEdge): boolean => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return true;
  const caret = selection.getRangeAt(0);
  if (!element.contains(caret.startContainer)) return true;
  const range = document.createRange();
  range.selectNodeContents(element);
  if (edge === 'start') {
    range.setEnd(caret.startContainer, caret.startOffset);
  } else {
    range.setStart(caret.endContainer, caret.endOffset);
  }
  const span = document.createElement('div');
  span.appendChild(range.cloneContents());
  return !serializeEditable(span).includes('\n');
};

/**
 * Shell-style recall of this conversation's earlier user messages.
 *
 * ArrowUp on an empty composer shows the newest user message; more ArrowUp
 * steps go older. ArrowDown steps newer and, past the newest, empties the
 * composer again. Recall stays active only while the draft still equals the
 * recalled text: any edit makes ArrowUp/ArrowDown ordinary caret keys again.
 * The mention popup handles its own arrows before this runs.
 */
export const useComposerHistoryRecall = ({
  editableRef,
  getUserMessages,
  replaceInput,
}: Options) => {
  const recallRef = useRef<RecallState | null>(null);

  const handleHistoryKeyDown = useCallback((event: KeyboardEvent): boolean => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return false;
    if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return false;
    const element = editableRef.current;
    if (!element || !getUserMessages) return false;

    const draft = serializeEditable(element);
    const recall = recallRef.current;
    const browsing = recall !== null && recall.text === draft;
    if (!browsing) recallRef.current = null;

    if (event.key === 'ArrowUp') {
      if (browsing ? !caretOnEdgeLine(element, 'start') : draft.trim() !== '') return false;
      const history = getUserMessages().filter(message => message.trim() !== '');
      const index = browsing ? recall.index + 1 : 0;
      if (index >= history.length) {
        // Already at the oldest message: keep the caret where it is.
        if (browsing) event.preventDefault();
        return browsing;
      }
      const text = history[history.length - 1 - index];
      event.preventDefault();
      recallRef.current = { index, text };
      replaceInput(text);
      return true;
    }

    if (!browsing || !caretOnEdgeLine(element, 'end')) return false;
    event.preventDefault();
    if (recall.index === 0) {
      recallRef.current = null;
      replaceInput('');
      return true;
    }
    const history = getUserMessages().filter(message => message.trim() !== '');
    const index = Math.min(recall.index - 1, history.length - 1);
    const text = history[history.length - 1 - index] ?? '';
    recallRef.current = { index, text };
    replaceInput(text);
    return true;
  }, [editableRef, getUserMessages, replaceInput]);

  return handleHistoryKeyDown;
};
