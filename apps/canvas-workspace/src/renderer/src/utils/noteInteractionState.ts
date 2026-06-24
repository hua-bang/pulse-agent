export interface NoteSlashMenuState {
  x: number;
  y: number;
  query: string;
  index: number;
  slashFrom: number;
}

export interface NoteMentionMenuState {
  x: number;
  y: number;
  query: string;
  index: number;
}

export interface NoteBubbleState {
  x: number;
  y: number;
  /** Bottom edge of the selection rect; used to flip the bubble below. */
  bottom: number;
}

export interface NoteLinkPromptState {
  initial: string;
}

export interface NoteInteractionState {
  slashMenu: NoteSlashMenuState | null;
  mentionMenu: NoteMentionMenuState | null;
  bubble: NoteBubbleState | null;
  linkPrompt: NoteLinkPromptState | null;
  findBarOpen: boolean;
  outlineOpen: boolean;
}

export type NoteInteractionUpdater<T> = T | ((prev: T | null) => T);

export const createEmptyNoteInteractionState = (): NoteInteractionState => ({
  slashMenu: null,
  mentionMenu: null,
  bubble: null,
  linkPrompt: null,
  findBarOpen: false,
  outlineOpen: false,
});

const nextValue = <T,>(current: T | null, value: NoteInteractionUpdater<T>): T =>
  typeof value === 'function' ? (value as (prev: T | null) => T)(current) : value;

const clampMenuIndex = (index: number, delta: number, itemCount: number) =>
  Math.max(0, Math.min(index + delta, itemCount - 1));

export const closeTransientNoteSurfaces = (
  state: NoteInteractionState,
): NoteInteractionState => ({
  ...state,
  slashMenu: null,
  mentionMenu: null,
  bubble: null,
  linkPrompt: null,
});

export const openSlashMenuState = (
  state: NoteInteractionState,
  next: NoteInteractionUpdater<NoteSlashMenuState>,
): NoteInteractionState => ({
  ...state,
  mentionMenu: null,
  bubble: null,
  linkPrompt: null,
  slashMenu: nextValue(state.slashMenu, next),
});

export const closeSlashMenuState = (state: NoteInteractionState): NoteInteractionState => ({
  ...state,
  slashMenu: null,
});

export const moveSlashMenuSelectionState = (
  state: NoteInteractionState,
  delta: number,
  itemCount: number,
): NoteInteractionState => {
  if (!state.slashMenu || itemCount <= 0) return state;
  return {
    ...state,
    slashMenu: {
      ...state.slashMenu,
      index: clampMenuIndex(state.slashMenu.index, delta, itemCount),
    },
  };
};

export const openMentionMenuState = (
  state: NoteInteractionState,
  next: NoteInteractionUpdater<NoteMentionMenuState>,
): NoteInteractionState => ({
  ...state,
  slashMenu: null,
  bubble: null,
  linkPrompt: null,
  mentionMenu: nextValue(state.mentionMenu, next),
});

export const closeMentionMenuState = (state: NoteInteractionState): NoteInteractionState => ({
  ...state,
  mentionMenu: null,
});

export const moveMentionMenuSelectionState = (
  state: NoteInteractionState,
  delta: number,
  itemCount: number,
): NoteInteractionState => {
  if (!state.mentionMenu || itemCount <= 0) return state;
  return {
    ...state,
    mentionMenu: {
      ...state.mentionMenu,
      index: clampMenuIndex(state.mentionMenu.index, delta, itemCount),
    },
  };
};

export const openBubbleState = (
  state: NoteInteractionState,
  next: NoteBubbleState,
): NoteInteractionState => {
  if (state.slashMenu || state.mentionMenu || state.linkPrompt || state.findBarOpen) {
    return { ...state, bubble: null };
  }
  return { ...state, bubble: next };
};

export const closeBubbleState = (state: NoteInteractionState): NoteInteractionState => ({
  ...state,
  bubble: null,
});

export const openLinkPromptState = (
  state: NoteInteractionState,
  initial: string,
): NoteInteractionState => ({
  ...state,
  slashMenu: null,
  mentionMenu: null,
  bubble: null,
  linkPrompt: { initial },
  findBarOpen: false,
});

export const closeLinkPromptState = (state: NoteInteractionState): NoteInteractionState => ({
  ...state,
  linkPrompt: null,
});

export const openFindBarState = (state: NoteInteractionState): NoteInteractionState => ({
  ...state,
  slashMenu: null,
  mentionMenu: null,
  bubble: null,
  linkPrompt: null,
  findBarOpen: true,
});

export const closeFindBarState = (state: NoteInteractionState): NoteInteractionState => ({
  ...state,
  findBarOpen: false,
});

export const toggleOutlineState = (state: NoteInteractionState): NoteInteractionState => ({
  ...closeTransientNoteSurfaces(state),
  outlineOpen: !state.outlineOpen,
});

export const closeOutlineState = (state: NoteInteractionState): NoteInteractionState => ({
  ...state,
  outlineOpen: false,
});
