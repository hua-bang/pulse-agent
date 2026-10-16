import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import type { CanvasNode, MentionItem } from '../../../../types';
import { createMentionChipElement, serializeEditable } from '../../mentions/mentions';
import { sortAndCapMentionItems } from '../ChatMentionPopup/constants';

interface Options {
  editableRef: RefObject<HTMLDivElement>;
  setInput: (value: string) => void;
  /** Nodes a picked node mention resolves its chip label and icon from. */
  nodes?: CanvasNode[];
  buildMentionItems: (query: string, trigger: '@' | '/') => Promise<MentionItem[]>;
  searchSessionMentionItems: (query: string) => Promise<MentionItem[]>;
}

/**
 * The `@` and `/` popup of a contentEditable composer: it finds the trigger
 * before the caret, builds the matching items, moves the highlight with the
 * keyboard, and swaps the query for a chip on pick. The chat composer and
 * the launcher share it; each owns its own draft and submit.
 */
export const useMentionPopup = ({
  editableRef,
  setInput,
  nodes,
  buildMentionItems,
  searchSessionMentionItems,
}: Options) => {
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionItems, setMentionItems] = useState<MentionItem[]>([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  /** Latest open state, read inside detectMention without re-creating it. */
  const mentionOpenRef = useRef(false);
  mentionOpenRef.current = mentionOpen;
  /** Trigger whose query selectMention must replace. */
  const mentionTriggerRef = useRef<'@' | '/'>('@');
  /** Prevents stale async popup builds from repainting or reopening. */
  const mentionBuildSeqRef = useRef(0);

  const closeMention = useCallback(() => {
    mentionBuildSeqRef.current++;
    setMentionLoading(false);
    setMentionOpen(false);
  }, []);

  const resetMention = useCallback(() => {
    closeMention();
    setMentionItems([]);
    setMentionIndex(0);
  }, [closeMention]);

  /** Opens, refines, or closes the popup for the text before the caret. */
  const detectMention = useCallback(() => {
    // Every input event supersedes any in-flight popup build.
    const buildSeq = ++mentionBuildSeqRef.current;

    const selection = window.getSelection();
    if (
      !selection
      || !selection.rangeCount
      || !selection.anchorNode
      || selection.anchorNode.nodeType !== Node.TEXT_NODE
    ) {
      setMentionLoading(false);
      setMentionOpen(false);
      setMentionItems([]);
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
      setMentionLoading(false);
      setMentionOpen(false);
      setMentionItems([]);
      return;
    }

    const trigger: '@' | '/' = match === atMatch ? '@' : '/';
    mentionTriggerRef.current = trigger;

    const query = match[1];
    const isStale = () => buildSeq !== mentionBuildSeqRef.current;
    // Refining an open popup keeps the current rows on screen until the new
    // ones land; clearing them per keystroke made the list flash a spinner.
    if (!mentionOpenRef.current) {
      setMentionItems([]);
      setMentionLoading(true);
    }
    setMentionIndex(0);
    setMentionOpen(true);
    // Start the cross-workspace session search alongside the local build,
    // but never let it hold back the local rows.
    const sessionSearch = trigger === '@' && query.trim()
      ? searchSessionMentionItems(query)
      : null;
    void buildMentionItems(query, trigger).then(async (items) => {
      if (isStale()) return;
      setMentionItems(items);
      // Only report loading while there is nothing to show, so "no results"
      // never appears before the session search has answered.
      setMentionLoading(Boolean(sessionSearch) && items.length === 0);
      if (!sessionSearch) return;
      const sessions = await sessionSearch;
      if (isStale()) return;
      if (sessions.length > 0) setMentionItems(sortAndCapMentionItems([...items, ...sessions]));
      setMentionLoading(false);
    }).catch(() => {
      if (isStale()) return;
      setMentionItems([]);
      setMentionLoading(false);
    });
  }, [buildMentionItems, searchSessionMentionItems]);

  // Dismiss when focus moves outside the composer/popup.
  useEffect(() => {
    if (!mentionOpen) return;
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (editableRef.current?.contains(target)) return;
      if (target.closest('.chat-mention-popup')) return;
      closeMention();
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [closeMention, editableRef, mentionOpen]);

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
    closeMention();
    element.focus();
  }, [closeMention, editableRef, nodes, setInput]);

  /**
   * Escape, arrows, Enter and Tab drive an open popup. Returns true when the
   * key was the popup's, so the composer skips its own handling.
   */
  const handleMentionKeyDown = useCallback((event: KeyboardEvent): boolean => {
    if (!mentionOpen) return false;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMention();
      return true;
    }
    if (mentionItems.length === 0) return false;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setMentionIndex(index => (index + 1) % mentionItems.length);
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setMentionIndex(index => (index - 1 + mentionItems.length) % mentionItems.length);
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      selectMention(mentionItems[mentionIndex]);
      return true;
    }
    return false;
  }, [closeMention, mentionIndex, mentionItems, mentionOpen, selectMention]);

  return {
    detectMention,
    handleMentionKeyDown,
    mentionIndex,
    mentionItems,
    mentionLoading,
    mentionOpen,
    resetMention,
    selectMention,
    setMentionIndex,
  };
};
