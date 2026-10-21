import { useCallback, useSyncExternalStore } from 'react';

/**
 * App color theme. The user picks a preference; `system` follows the OS
 * through `prefers-color-scheme`. The resolved theme is written to the root
 * element as the `dark` class, which styles.css keys its dark token set on.
 * MCP App icons and the MCP host context already read that class.
 */
export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

const STORAGE_KEY = 'pulse-canvas.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

const isThemePreference = (value: unknown): value is ThemePreference => (
  typeof value === 'string' && THEME_PREFERENCES.includes(value as ThemePreference)
);

const readStoredPreference = (): ThemePreference => {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isThemePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
};

const systemPrefersDark = (): boolean => (
  typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches
);

let preference: ThemePreference = 'system';
let resolved: ResolvedTheme = 'light';
const listeners = new Set<() => void>();

const notify = (): void => listeners.forEach((listener) => listener());

/** Resolve the preference onto the root element. Returns whether it changed. */
const apply = (): boolean => {
  const next: ResolvedTheme = preference === 'dark' || (preference === 'system' && systemPrefersDark())
    ? 'dark'
    : 'light';
  const changed = next !== resolved;
  resolved = next;
  document.documentElement.classList.toggle('dark', next === 'dark');
  return changed;
};

/** Apply the stored theme before the first render and follow OS changes. */
export const installTheme = (): void => {
  preference = readStoredPreference();
  apply();
  window.matchMedia?.(DARK_QUERY).addEventListener('change', () => {
    if (preference === 'system' && apply()) notify();
  });
};

export const getResolvedTheme = (): ResolvedTheme => resolved;

/** Subscribe to resolved-theme changes. Returns the unsubscribe function. */
export const onThemeChange = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const setThemePreference = (next: ThemePreference): void => {
  preference = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* theme preference is best-effort */
  }
  apply();
  // Notify even when the resolved theme is unchanged (system -> light on a
  // light OS) so the settings control re-renders.
  notify();
};

export const useThemePreference = (): [ThemePreference, (next: ThemePreference) => void] => {
  const current = useSyncExternalStore(onThemeChange, () => preference);
  const update = useCallback((next: ThemePreference) => setThemePreference(next), []);
  return [current, update];
};

export const useResolvedTheme = (): ResolvedTheme => useSyncExternalStore(onThemeChange, getResolvedTheme);
