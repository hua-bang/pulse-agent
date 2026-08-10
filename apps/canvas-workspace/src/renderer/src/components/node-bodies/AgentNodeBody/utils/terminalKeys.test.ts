import { describe, expect, it } from 'vitest';
import { TERMINAL_ESCAPE_HATCH_MS, decideTerminalKey } from './terminal';

const key = (
  overrides: Partial<Parameters<typeof decideTerminalKey>[0]> & { key: string },
) => ({ type: 'keydown', ctrlKey: false, metaKey: false, altKey: false, ...overrides });

describe('decideTerminalKey', () => {
  it('leaves the terminal owning its own control language', () => {
    // Ctrl+C interrupt, Ctrl+K kill-line, Ctrl+H backspace, Ctrl+\ SIGQUIT.
    for (const k of ['c', 'k', 'h', '\\']) {
      expect(decideTerminalKey(key({ key: k, ctrlKey: true }), 0, 1000)).toBe('terminal');
    }
  });

  it('gives Cmd-chords to the app so a focused terminal is not a black hole', () => {
    expect(decideTerminalKey(key({ key: 'k', metaKey: true }), 0, 1000)).toBe('app');
    expect(decideTerminalKey(key({ key: '1', metaKey: true }), 0, 1000)).toBe('app');
  });

  it('keeps a single Escape with the shell', () => {
    expect(decideTerminalKey(key({ key: 'Escape' }), 0, 10_000)).toBe('terminal');
  });

  it('releases focus on a second Escape inside the window', () => {
    expect(decideTerminalKey(key({ key: 'Escape' }), 1000, 1000 + TERMINAL_ESCAPE_HATCH_MS - 1))
      .toBe('release-focus');
    expect(decideTerminalKey(key({ key: 'Escape' }), 1000, 1000 + TERMINAL_ESCAPE_HATCH_MS + 1))
      .toBe('terminal');
  });

  it('ignores keyup so a decision is made once per press', () => {
    expect(decideTerminalKey(key({ key: 'k', metaKey: true, type: 'keyup' }), 0, 1000))
      .toBe('terminal');
  });
});
