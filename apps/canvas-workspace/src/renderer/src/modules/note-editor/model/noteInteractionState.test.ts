import { describe, expect, it } from 'vitest';
import {
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
  type NoteMentionMenuState,
  type NoteSlashMenuState,
} from './noteInteractionState';

const slashMenu: NoteSlashMenuState = {
  x: 10,
  y: 20,
  query: 'h',
  index: 0,
  slashFrom: 5,
};

const mentionMenu: NoteMentionMenuState = {
  x: 30,
  y: 40,
  query: 'road',
  index: 1,
};

const bubble: NoteBubbleState = {
  x: 50,
  y: 60,
  bottom: 72,
};

const busyState = (): NoteInteractionState => ({
  ...createEmptyNoteInteractionState(),
  slashMenu,
  mentionMenu,
  bubble,
  linkPrompt: { initial: 'https://example.com' },
  findBarOpen: true,
  outlineOpen: true,
});

describe('noteInteractionState', () => {
  it('opens slash as the active inline menu while preserving outline and find state', () => {
    expect(openSlashMenuState(busyState(), { ...slashMenu, query: 'todo' })).toEqual({
      slashMenu: { ...slashMenu, query: 'todo' },
      mentionMenu: null,
      bubble: null,
      linkPrompt: null,
      findBarOpen: true,
      outlineOpen: true,
    });
  });

  it('opens mention as the active inline menu while preserving outline and find state', () => {
    expect(openMentionMenuState(busyState(), { ...mentionMenu, query: 'design' })).toEqual({
      slashMenu: null,
      mentionMenu: { ...mentionMenu, query: 'design' },
      bubble: null,
      linkPrompt: null,
      findBarOpen: true,
      outlineOpen: true,
    });
  });

  it('opens find and clears transient authoring surfaces', () => {
    expect(openFindBarState(busyState())).toEqual({
      slashMenu: null,
      mentionMenu: null,
      bubble: null,
      linkPrompt: null,
      findBarOpen: true,
      outlineOpen: true,
    });
  });

  it('opens link prompt and gives it ownership over find and menus', () => {
    expect(openLinkPromptState(busyState(), 'https://pulse.local')).toEqual({
      slashMenu: null,
      mentionMenu: null,
      bubble: null,
      linkPrompt: { initial: 'https://pulse.local' },
      findBarOpen: false,
      outlineOpen: true,
    });
  });

  it('toggles outline without closing find', () => {
    const state = {
      ...busyState(),
      outlineOpen: false,
    };

    expect(toggleOutlineState(state)).toEqual({
      slashMenu: null,
      mentionMenu: null,
      bubble: null,
      linkPrompt: null,
      findBarOpen: true,
      outlineOpen: true,
    });
  });

  it('suppresses selection bubble while another surface owns keyboard or selection', () => {
    expect(
      openBubbleState({ ...createEmptyNoteInteractionState(), slashMenu }, bubble).bubble,
    ).toBeNull();
    expect(
      openBubbleState({ ...createEmptyNoteInteractionState(), mentionMenu }, bubble).bubble,
    ).toBeNull();
    expect(
      openBubbleState(
        { ...createEmptyNoteInteractionState(), linkPrompt: { initial: '' } },
        bubble,
      ).bubble,
    ).toBeNull();
    expect(
      openBubbleState(
        { ...createEmptyNoteInteractionState(), findBarOpen: true },
        bubble,
      ).bubble,
    ).toBeNull();
    expect(openBubbleState(createEmptyNoteInteractionState(), bubble).bubble).toEqual(bubble);
  });

  it('clamps menu selection movement to available items', () => {
    expect(
      moveSlashMenuSelectionState(
        { ...createEmptyNoteInteractionState(), slashMenu: { ...slashMenu, index: 1 } },
        5,
        3,
      ).slashMenu?.index,
    ).toBe(2);
    expect(
      moveMentionMenuSelectionState(
        { ...createEmptyNoteInteractionState(), mentionMenu: { ...mentionMenu, index: 1 } },
        -5,
        3,
      ).mentionMenu?.index,
    ).toBe(0);
  });

  it('closes transient surfaces without touching find or outline', () => {
    expect(closeTransientNoteSurfaces(busyState())).toEqual({
      slashMenu: null,
      mentionMenu: null,
      bubble: null,
      linkPrompt: null,
      findBarOpen: true,
      outlineOpen: true,
    });
  });
});
