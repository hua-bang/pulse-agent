// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type ChangeListener = () => void;

const installMatchMedia = (initialDark: boolean) => {
  const listeners: ChangeListener[] = [];
  const media = {
    matches: initialDark,
    addEventListener: (_type: string, listener: ChangeListener) => listeners.push(listener),
  };
  window.matchMedia = vi.fn(() => media) as unknown as typeof window.matchMedia;
  return {
    setDark: (dark: boolean) => {
      media.matches = dark;
      listeners.forEach((listener) => listener());
    },
  };
};

const loadTheme = async () => {
  vi.resetModules();
  return import('./theme');
};

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('theme', () => {
  it('follows the OS by default and tracks OS changes', async () => {
    const os = installMatchMedia(false);
    const theme = await loadTheme();
    theme.installTheme();
    expect(theme.getResolvedTheme()).toBe('light');

    const listener = vi.fn();
    theme.onThemeChange(listener);
    os.setDark(true);

    expect(theme.getResolvedTheme()).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps a manual preference over the OS and persists it', async () => {
    const os = installMatchMedia(false);
    const theme = await loadTheme();
    theme.installTheme();

    theme.setThemePreference('dark');
    os.setDark(false);

    expect(theme.getResolvedTheme()).toBe('dark');
    expect(window.localStorage.getItem('pulse-canvas.theme')).toBe('dark');
  });

  it('applies the stored preference on install', async () => {
    installMatchMedia(true);
    window.localStorage.setItem('pulse-canvas.theme', 'light');
    const theme = await loadTheme();
    theme.installTheme();

    expect(theme.getResolvedTheme()).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
