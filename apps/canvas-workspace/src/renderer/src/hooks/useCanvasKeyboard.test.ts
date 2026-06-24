import { describe, expect, it } from 'vitest';
import { shouldHandleCanvasFindShortcut } from './useCanvasKeyboard';

const modF = (overrides: Partial<Parameters<typeof shouldHandleCanvasFindShortcut>[0]> = {}) => ({
  ctrlKey: false,
  key: 'f',
  metaKey: true,
  shiftKey: false,
  ...overrides,
});

const elementInNote = () => ({
  tagName: 'DIV',
  closest: (selector: string) => (selector === '.note-card' ? { tagName: 'DIV' } : null),
});

const elementOutsideNote = (tagName = 'DIV') => ({
  tagName,
  closest: () => null,
});

describe('shouldHandleCanvasFindShortcut', () => {
  it('lets note-local find own Cmd/Ctrl+F while focus is inside a note card', () => {
    expect(shouldHandleCanvasFindShortcut(modF(), elementInNote())).toBe(false);
  });

  it('handles Cmd/Ctrl+F outside note cards, including regular editable controls', () => {
    expect(shouldHandleCanvasFindShortcut(modF(), elementOutsideNote())).toBe(true);
    expect(shouldHandleCanvasFindShortcut(modF({ ctrlKey: true, metaKey: false }), elementOutsideNote('INPUT')))
      .toBe(true);
  });

  it('ignores unrelated or already-handled key events', () => {
    expect(shouldHandleCanvasFindShortcut(modF({ defaultPrevented: true }), elementOutsideNote()))
      .toBe(false);
    expect(shouldHandleCanvasFindShortcut(modF({ key: 'k' }), elementOutsideNote())).toBe(false);
    expect(shouldHandleCanvasFindShortcut(modF({ shiftKey: true }), elementOutsideNote())).toBe(false);
  });
});
