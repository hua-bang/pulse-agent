import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import type { CanvasNode } from '../types';
import { isImeComposing } from '../utils/ime';
import { detectMention, filterMentionCandidates } from '../utils/noteMention';
import { nodeLinkHref } from '../utils/openNodeBridge';
import type { NoteInteractionController } from './useNoteInteractionController';

interface Options {
  editor: Editor | null;
  candidates: CanvasNode[];
  readOnly: boolean;
  workspaceId?: string;
  interactions: NoteInteractionController;
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
export const useNoteMentions = ({ editor, candidates, readOnly, workspaceId, interactions }: Options) => {
  const {
    mentionMenu,
    mentionMenuRef,
    openMentionMenu,
    closeMentionMenu,
    moveMentionSelection,
  } = interactions;

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
      if (mentionMenuRef.current) closeMentionMenu();
      return;
    }
    let coords: { left: number; bottom: number };
    try {
      coords = editor.view.coordsAtPos(hit.atDocPos);
    } catch {
      return;
    }
    openMentionMenu((prev) => ({
      x: coords.left,
      y: coords.bottom,
      query: hit.trigger.query,
      index: prev && prev.query === hit.trigger.query ? prev.index : 0,
    }));
  }, [editor, readOnly, mentionMenuRef, openMentionMenu, closeMentionMenu]);

  useEffect(() => {
    if (!editor) return;
    editor.on('update', recompute);
    editor.on('selectionUpdate', recompute);
    return () => {
      editor.off('update', recompute);
      editor.off('selectionUpdate', recompute);
    };
  }, [editor, recompute]);

  const closeMention = closeMentionMenu;

  const insertMention = useCallback(
    (node: CanvasNode) => {
      closeMentionMenu();
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
            marks: [{ type: 'link', attrs: { href: nodeLinkHref(node.id, workspaceId) } }],
          },
          { type: 'text', text: ' ' },
        ])
        .run();
    },
    [editor, readOnly, workspaceId, closeMentionMenu],
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
        moveMentionSelection(1, items.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopImmediatePropagation();
        moveMentionSelection(-1, items.length);
      } else if (e.key === 'Enter') {
        const item = items[menu.index] ?? items[0];
        if (item) {
          e.preventDefault();
          e.stopImmediatePropagation();
          insertMention(item);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeMentionMenu();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [editor, readOnly, insertMention, mentionMenuRef, moveMentionSelection, closeMentionMenu]);

  return { mentionMenu, filteredMentions: filtered, insertMention, closeMention };
};
