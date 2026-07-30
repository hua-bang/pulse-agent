import { describe, expect, it } from 'vitest';
import { DOCK_FOCUS_SCOPED_COMMANDS, resolveDockBrowserCommand } from './dock-shortcuts';

describe('resolveDockBrowserCommand', () => {
  it('accepts both platform modifiers for the same chord', () => {
    expect(resolveDockBrowserCommand({ key: 'w', metaKey: true })).toBe('close-tab');
    expect(resolveDockBrowserCommand({ key: 'w', ctrlKey: true })).toBe('close-tab');
  });

  it('separates shifted chords from their unshifted twins', () => {
    expect(resolveDockBrowserCommand({ key: 't', metaKey: true })).toBe('new-tab');
    expect(resolveDockBrowserCommand({ key: 'T', metaKey: true, shiftKey: true })).toBe('reopen-tab');
  });

  it('is case-insensitive, because Shift changes the reported key', () => {
    expect(resolveDockBrowserCommand({ key: 'L', metaKey: true })).toBe('focus-address');
  });

  it('leaves unmodified keys to the page', () => {
    // A bare letter must keep reaching the guest — the user is typing in it.
    expect(resolveDockBrowserCommand({ key: 't' })).toBeNull();
    expect(resolveDockBrowserCommand({ key: 'w', shiftKey: true })).toBeNull();
  });

  it('never claims Alt-modified chords', () => {
    expect(resolveDockBrowserCommand({ key: 'w', metaKey: true, altKey: true })).toBeNull();
  });

  it('ignores chords it does not own', () => {
    expect(resolveDockBrowserCommand({ key: 'c', metaKey: true })).toBeNull();
    expect(resolveDockBrowserCommand({ key: 'v', metaKey: true })).toBeNull();
    expect(resolveDockBrowserCommand({ key: 'Enter', metaKey: true })).toBeNull();
  });

  it('scopes only the chords the canvas also binds', () => {
    // Cmd+F is find-in-page here and find-on-canvas there, so it may only be
    // claimed when focus is already in the dock. Cmd+W and friends are not
    // contested and must work wherever the dock is visible.
    expect(resolveDockBrowserCommand({ key: 'f', metaKey: true })).toBe('find');
    expect(DOCK_FOCUS_SCOPED_COMMANDS.has('find')).toBe(true);
    expect(DOCK_FOCUS_SCOPED_COMMANDS.has('close-tab')).toBe(false);
    expect(DOCK_FOCUS_SCOPED_COMMANDS.has('new-tab')).toBe(false);
  });

  it('cycles tabs with the bracket chords', () => {
    expect(resolveDockBrowserCommand({ key: ']', metaKey: true, shiftKey: true })).toBe('next-tab');
    expect(resolveDockBrowserCommand({ key: '[', metaKey: true, shiftKey: true })).toBe('previous-tab');
  });
});
