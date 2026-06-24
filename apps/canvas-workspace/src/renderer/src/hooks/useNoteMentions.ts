import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import type { CanvasNode } from '../types';
import { isImeComposing } from '../utils/ime';
import { detectMention, filterMentionCandidates } from '../utils/noteMention';
import { nodeLinkHref } from '../utils/openNodeBridge';

interface MentionMenuState {
  x: number;
  y: number;
  query: string;
  index: number;
}

interface Options {
  editor: Editor | null;
  candidates: CanvasNode[];
  readOnly: boolean;
}

/** Number of chars before the caret we inspect for an `@` trigger. */
const LOOKBEHIND = 60;

const triggerBeforeCaret = (editor: Editor) => {
  const { from } = editor.state.selection;
  const startPos = Math.max(0, from - LOOKBEHIND);
  const textBefore = editor.state.doc.textBetween(startPos, from, '\n', '\0');
  const trigger = detectMention(textBefore);
  return trigger ? { trigger, from, atDocPos: startPos + trigger.atIndex } : null;
};

/**
 * Inline `@` node-mention picker for the note editor. Watches the caret for an
 * `@query`, surfaces a candidate list, and inserts the picked node as a
 * `pulse-canvas://node/<id>` link (which round-trips through markdown and is
 * made clickable by the note's link handler).
 */
export const useNoteMentions = ({ editor, candidates, readOnly }: Options) => {
  const [mentionMenu, setMentionMenu] = useState<MentionMenuState | null>(null);
  const mentionMenuRef = useRef<MentionMenuState | null>(null);
  mentionMenuRef.current = mentionMenu;

  const filtered = useMemo(
    () => (mentionMenu ? filterMentionCandidates(candidates, mentionMenu.query) : []),
    [mentionMenu, candidates],
  );
  const filteredRef = useRef(filtered);
  filteredRef.current = filtered;

  const recompute = useCallback(() => {
    if (!editor || readOnly) return;
    const hit = triggerBeforeCaret(editor);
    if (!hit) {
      if (mentionMenuRef.current) setMentionMenu(null);
      return;
    }
    let coords: { left: number; bottom: number };
    try {
      coords = editor.view.coordsAtPos(hit.atDocPos);
    } catch {
      return;
    }
    setMentionMenu((prev) => ({
      x: coords.left,
      y: coords.bottom,
      query: hit.trigger.query,
      index: prev && prev.query === hit.trigger.query ? prev.index : 0,
    }));
  }, [editor, readOnly]);

  useEffect(() => {
    if (!editor) return;
    editor.on('update', recompute);
    editor.on('selectionUpdate', recompute);
    return () => {
      editor.off('update', recompute);
      editor.off('selectionUpdate', recompute);
    };
  }, [editor, recompute]);

  const closeMention = useCallback(() => setMentionMenu(null), []);

  const insertMention = useCallback(
    (node: CanvasNode) => {
      setMentionMenu(null);
      if (!editor || readOnly) return;
      const hit = triggerBeforeCaret(editor);
      if (!hit) return;
      const label = (node.title || '').trim() || 'Untitled';
      editor
        .chain()
        .focus()
        .deleteRange({ from: hit.atDocPos, to: hit.from })
        .insertContent([
          {
            type: 'text',
            text: `@${label}`,
            marks: [{ type: 'link', attrs: { href: nodeLinkHref(node.id) } }],
          },
          { type: 'text', text: ' ' },
        ])
        .run();
    },
    [editor, readOnly],
  );

  // Keyboard navigation — capture phase so we steer before ProseMirror.
  useEffect(() => {
    if (!editor || readOnly) return;
    const handler = (e: KeyboardEvent) => {
      const menu = mentionMenuRef.current;
      if (!menu || isImeComposing(e)) return;
      const items = filteredRef.current;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopImmediatePropagation();
        setMentionMenu((prev) => (prev ? { ...prev, index: Math.min(prev.index + 1, items.length - 1) } : null));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopImmediatePropagation();
        setMentionMenu((prev) => (prev ? { ...prev, index: Math.max(prev.index - 1, 0) } : null));
      } else if (e.key === 'Enter') {
        const item = items[menu.index] ?? items[0];
        if (item) {
          e.preventDefault();
          e.stopImmediatePropagation();
          insertMention(item);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setMentionMenu(null);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [editor, readOnly, insertMention]);

  return { mentionMenu, filteredMentions: filtered, insertMention, closeMention };
};
