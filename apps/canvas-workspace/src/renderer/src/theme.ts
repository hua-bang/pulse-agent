/**
 * Renderer-local appearance theme. `classic` is the default Notion-paper
 * look (bare :root tokens in styles.css); `spatial` activates the
 * get-spatial.com-inspired token overlay via `data-theme` on <html>.
 * Persisted like the i18n language choice: localStorage, per device.
 * Applied before first render from main.tsx (App.tsx is size-frozen).
 */
export type CanvasTheme = 'classic' | 'spatial';

export const THEME_STORAGE_KEY = 'pulse-canvas.theme';

const DEFAULT_THEME: CanvasTheme = 'classic';
const THEMES: readonly CanvasTheme[] = ['classic', 'spatial'];

const isCanvasTheme = (value: unknown): value is CanvasTheme =>
  typeof value === 'string' && (THEMES as readonly string[]).includes(value);

export const getStoredTheme = (): CanvasTheme => {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return isCanvasTheme(stored) ? stored : DEFAULT_THEME;
};

export const applyTheme = (theme: CanvasTheme): void => {
  if (theme === DEFAULT_THEME) {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
};

/** Apply the persisted choice; called once before the first React render. */
export const initStoredTheme = (): void => {
  applyTheme(getStoredTheme());
};
