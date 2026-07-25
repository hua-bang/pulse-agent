import { useEffect, type RefObject } from 'react';
import type { Editor } from '@tiptap/react';
import type { NoteInteractionController } from './useNoteInteractionController';

interface Options {
  editor: Editor | null;
  cardRef: RefObject<HTMLDivElement>;
  readOnly: boolean;
  interactions: NoteInteractionController;
}

/** Closes the outline with Escape only when this note owns the interaction. */
export const useNoteOutlineEscape = ({
  editor,
  cardRef,
  readOnly,
  interactions,
}: Options) => {
  const {
    outlineOpen,
    slashMenu,
    mentionMenu,
    linkPrompt,
    findBarOpen,
    closeOutline,
  } = interactions;

  useEffect(() => {
    if (
      readOnly
      || !outlineOpen
      || slashMenu
      || mentionMenu
      || linkPrompt
      || findBarOpen
    ) {
      return;
    }

    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target instanceof Node ? event.target : null;
      const belongsToNote =
        (target && cardRef.current?.contains(target)) || editor?.isFocused;
      if (!belongsToNote) return;

      event.preventDefault();
      event.stopPropagation();
      closeOutline();
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [
    cardRef,
    closeOutline,
    editor,
    findBarOpen,
    linkPrompt,
    mentionMenu,
    outlineOpen,
    readOnly,
    slashMenu,
  ]);
};
