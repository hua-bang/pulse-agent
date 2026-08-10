import { describe, expect, it } from 'vitest';
import { CHAT_TAB_ID } from './dock-store';
import { getDockTabVisualState } from './dock-tab-visual-state';

describe('getDockTabVisualState', () => {
  it('marks chat and split content as a visible pair while preserving focus', () => {
    expect(getDockTabVisualState(CHAT_TAB_ID, CHAT_TAB_ID, 'link-1')).toEqual({
      focused: true,
      selected: true,
      splitActive: true,
      splitVisible: true,
      splitPart: 'chat',
    });
    expect(getDockTabVisualState('link-1', CHAT_TAB_ID, 'link-1')).toEqual({
      focused: false,
      selected: true,
      splitActive: true,
      splitVisible: true,
      splitPart: 'content',
    });
  });

  it('uses the regular single-tab state outside split view', () => {
    expect(getDockTabVisualState('link-1', 'link-1', undefined)).toEqual({
      focused: true,
      selected: true,
      splitActive: false,
      splitVisible: false,
      splitPart: undefined,
    });
  });

  it('does not mark unrelated tabs as visible in split view', () => {
    expect(getDockTabVisualState('link-2', CHAT_TAB_ID, 'link-1')).toEqual({
      focused: false,
      selected: false,
      splitActive: true,
      splitVisible: false,
      splitPart: undefined,
    });
  });
});
