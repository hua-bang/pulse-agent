import { useCallback, useRef, useState } from 'react';
import {
  closeBubbleState,
  closeFindBarState,
  closeLinkPromptState,
  closeMentionMenuState,
  closeOutlineState,
  closeSlashMenuState,
  closeTransientNoteSurfaces,
  createEmptyNoteInteractionState,
  moveMentionMenuSelectionState,
  moveSlashMenuSelectionState,
  openBubbleState,
  openFindBarState,
  openLinkPromptState,
  openMentionMenuState,
  openSlashMenuState,
  toggleOutlineState,
  type NoteBubbleState,
  type NoteInteractionState,
  type NoteInteractionUpdater,
  type NoteMentionMenuState,
  type NoteSlashMenuState,
} from '../utils/noteInteractionState';

export type {
  NoteBubbleState,
  NoteInteractionState,
  NoteInteractionUpdater,
  NoteLinkPromptState,
  NoteMentionMenuState,
  NoteSlashMenuState,
} from '../utils/noteInteractionState';

/**
 * Single owner for Note editor interaction surfaces.
 *
 * Notion-like editing depends less on any one feature and more on predictable
 * ownership: a slash menu, mention menu, selection bubble, find bar, outline,
 * and link prompt should never fight for focus or keyboard events.
 */
export const useNoteInteractionController = () => {
  const [state, setState] = useState<NoteInteractionState>(createEmptyNoteInteractionState);
  const { slashMenu, mentionMenu, bubble, linkPrompt, findBarOpen, outlineOpen } = state;

  const slashMenuRef = useRef<NoteSlashMenuState | null>(slashMenu);
  slashMenuRef.current = slashMenu;
  const mentionMenuRef = useRef<NoteMentionMenuState | null>(mentionMenu);
  mentionMenuRef.current = mentionMenu;

  const openSlashMenu = useCallback((next: NoteInteractionUpdater<NoteSlashMenuState>) => {
    setState((current) => openSlashMenuState(current, next));
  }, []);

  const closeSlashMenu = useCallback(() => setState(closeSlashMenuState), []);

  const moveSlashSelection = useCallback((delta: number, itemCount: number) => {
    setState((current) => moveSlashMenuSelectionState(current, delta, itemCount));
  }, []);

  const openMentionMenu = useCallback((next: NoteInteractionUpdater<NoteMentionMenuState>) => {
    setState((current) => openMentionMenuState(current, next));
  }, []);

  const closeMentionMenu = useCallback(() => setState(closeMentionMenuState), []);

  const moveMentionSelection = useCallback((delta: number, itemCount: number) => {
    setState((current) => moveMentionMenuSelectionState(current, delta, itemCount));
  }, []);

  const openBubble = useCallback((next: NoteBubbleState) => {
    setState((current) => openBubbleState(current, next));
  }, []);

  const closeBubble = useCallback(() => setState(closeBubbleState), []);

  const openLinkPrompt = useCallback((initial: string) => {
    setState((current) => openLinkPromptState(current, initial));
  }, []);

  const closeLinkPrompt = useCallback(() => setState(closeLinkPromptState), []);

  const openFindBar = useCallback(() => {
    setState(openFindBarState);
  }, []);

  const closeFindBar = useCallback(() => setState(closeFindBarState), []);

  const toggleOutline = useCallback(() => {
    setState(toggleOutlineState);
  }, []);

  const closeOutline = useCallback(() => setState(closeOutlineState), []);

  const closeEditorTransientSurfaces = useCallback(() => {
    setState(closeTransientNoteSurfaces);
  }, []);

  const resetForReadOnly = useCallback(() => {
    setState(createEmptyNoteInteractionState());
  }, []);

  return {
    slashMenu,
    slashMenuRef,
    openSlashMenu,
    closeSlashMenu,
    moveSlashSelection,
    mentionMenu,
    mentionMenuRef,
    openMentionMenu,
    closeMentionMenu,
    moveMentionSelection,
    bubble,
    openBubble,
    closeBubble,
    linkPrompt,
    openLinkPrompt,
    closeLinkPrompt,
    findBarOpen,
    openFindBar,
    closeFindBar,
    outlineOpen,
    toggleOutline,
    closeOutline,
    closeEditorTransientSurfaces,
    resetForReadOnly,
  };
};

export type NoteInteractionController = ReturnType<typeof useNoteInteractionController>;
