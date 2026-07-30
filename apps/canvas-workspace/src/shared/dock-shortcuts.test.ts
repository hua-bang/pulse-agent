import { describe, expect, it } from 'vitest';
import { resolveDockBrowserCommand } from './dock-shortcuts';

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

  it('cycles tabs with the bracket chords', () => {
    expect(resolveDockBrowserCommand({ key: ']', metaKey: true, shiftKey: true })).toBe('next-tab');
    expect(resolveDockBrowserCommand({ key: '[', metaKey: true, shiftKey: true })).toBe('previous-tab');
  });
});
