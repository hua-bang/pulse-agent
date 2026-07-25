import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatShortcut } from './keyboardShortcut';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('formatShortcut', () => {
  it('uses macOS glyphs on Apple platforms', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: 'Test' });
    expect(formatShortcut({ mod: true, shift: true, key: 'D' })).toBe('⌘⇧D');
    expect(formatShortcut({ alt: true, shift: true, key: '↑' })).toBe('⌥⇧↑');
  });

  it('uses explicit modifier names on other platforms', () => {
    vi.stubGlobal('navigator', { platform: 'Win32', userAgent: 'Test' });
    expect(formatShortcut({ mod: true, shift: true, key: 'D' })).toBe('Ctrl+Shift+D');
    expect(formatShortcut({ alt: true, shift: true, key: '↑' })).toBe('Alt+Shift+↑');
  });
});
