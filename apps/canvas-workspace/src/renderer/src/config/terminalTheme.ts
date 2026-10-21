import type { ITerminalAddon, ITerminalOptions, ITheme, Terminal } from '@xterm/xterm';
import { getResolvedTheme, onThemeChange } from '../shared/theme';
import { createTerminalLinkHandler } from './terminalLinkHandler';

export const BASE_TERMINAL_FONT_SIZE = 12;

/** Bounds and step for user-driven terminal zoom (Ctrl +/-). */
export const MIN_TERMINAL_FONT_SIZE = 8;
export const MAX_TERMINAL_FONT_SIZE = 32;
export const TERMINAL_FONT_SIZE_STEP = 1;

/** localStorage key for the user's preferred sidebar terminal font size. */
export const TERMINAL_FONT_SIZE_STORAGE_KEY = 'canvas-workspace:terminal-font-size';

/** Clamp a font size into the supported zoom range. */
export const clampTerminalFontSize = (value: number): number => {
  if (!Number.isFinite(value)) return BASE_TERMINAL_FONT_SIZE;
  return Math.min(MAX_TERMINAL_FONT_SIZE, Math.max(MIN_TERMINAL_FONT_SIZE, Math.round(value)));
};

/** Read the persisted terminal font size, falling back to the base size. */
export const readStoredTerminalFontSize = (): number => {
  if (typeof window === 'undefined') return BASE_TERMINAL_FONT_SIZE;
  try {
    const raw = window.localStorage.getItem(TERMINAL_FONT_SIZE_STORAGE_KEY);
    if (!raw) return BASE_TERMINAL_FONT_SIZE;
    return clampTerminalFontSize(Number(raw));
  } catch {
    return BASE_TERMINAL_FONT_SIZE;
  }
};

/** Persist the user's preferred terminal font size (best-effort). */
export const storeTerminalFontSize = (size: number): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TERMINAL_FONT_SIZE_STORAGE_KEY, String(clampTerminalFontSize(size)));
  } catch {
    /* font size preference is best-effort */
  }
};

const LIGHT_TERMINAL_THEME: ITheme = {
  background: '#fafaf9',
  foreground: '#37352f',
  cursor: '#37352f',
  cursorAccent: '#fafaf9',
  selectionBackground: 'rgba(35, 131, 226, 0.15)',
  selectionForeground: '#37352f',
  black: '#37352f',
  red: '#eb5757',
  green: '#0f7b6c',
  yellow: '#d9730d',
  blue: '#2383e2',
  magenta: '#9575d4',
  cyan: '#0f7b6c',
  white: '#787774',
  brightBlack: '#787774',
  brightRed: '#eb5757',
  brightGreen: '#0f7b6c',
  brightYellow: '#d9730d',
  brightBlue: '#2383e2',
  brightMagenta: '#9575d4',
  brightCyan: '#0f7b6c',
  brightWhite: '#37352f',
};

const DARK_TERMINAL_THEME: ITheme = {
  background: '#1b1b1a',
  foreground: '#dcdcd8',
  cursor: '#dcdcd8',
  cursorAccent: '#1b1b1a',
  selectionBackground: 'rgba(58, 146, 234, 0.3)',
  selectionForeground: '#f4f4f2',
  black: '#3a3a38',
  red: '#f07167',
  green: '#4fbf86',
  yellow: '#e7a456',
  blue: '#5aa5ef',
  magenta: '#b39ae8',
  cyan: '#33b5a0',
  white: '#b4b4ae',
  brightBlack: '#8a8a85',
  brightRed: '#f4928a',
  brightGreen: '#74d3a2',
  brightYellow: '#f0bd7a',
  brightBlue: '#82bcf4',
  brightMagenta: '#c9b6f0',
  brightCyan: '#5fcdbb',
  brightWhite: '#f4f4f2',
};

const currentTerminalTheme = (): ITheme => (
  getResolvedTheme() === 'dark' ? DARK_TERMINAL_THEME : LIGHT_TERMINAL_THEME
);

/**
 * Keeps a terminal on the app theme. Load it on every xterm instance; the
 * terminal disposes the addon, which drops the theme subscription.
 */
export class TerminalThemeAddon implements ITerminalAddon {
  private unsubscribe: (() => void) | null = null;

  activate(term: Terminal): void {
    term.options.theme = currentTerminalTheme();
    this.unsubscribe = onThemeChange(() => {
      term.options.theme = currentTerminalTheme();
    });
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}

export const TERMINAL_OPTIONS: ITerminalOptions = {
  fontSize: BASE_TERMINAL_FONT_SIZE,
  lineHeight: 1.4,
  letterSpacing: 0,
  fontFamily: "'SF Mono', SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  // CLI output often paints secondary lines with the SGR dim attribute or a
  // grey (brightBlack), which on this near-white background blends almost
  // into the surface and becomes unreadable. Enforce a minimum contrast so
  // xterm darkens any failing foreground (dimmed greys included) to stay
  // legible, while already high-contrast text is left untouched.
  minimumContrastRatio: 4.5,
  theme: LIGHT_TERMINAL_THEME,
  cursorBlink: true,
  cursorStyle: 'bar',
  allowTransparency: true,
  scrollback: 5000,
  smoothScrollDuration: 100,
  linkHandler: createTerminalLinkHandler(),
};
