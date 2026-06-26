import type { ITerminalOptions } from '@xterm/xterm';

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

export const TERMINAL_OPTIONS: ITerminalOptions = {
  fontSize: BASE_TERMINAL_FONT_SIZE,
  lineHeight: 1.4,
  letterSpacing: 0,
  fontFamily: "'SF Mono', 'Fira Code', Menlo, 'Cascadia Code', monospace",
  // CLI output often paints secondary lines with the SGR dim attribute or a
  // grey (brightBlack), which on this near-white background blends almost
  // into the surface and becomes unreadable. Enforce a minimum contrast so
  // xterm darkens any failing foreground (dimmed greys included) to stay
  // legible, while already high-contrast text is left untouched.
  minimumContrastRatio: 4.5,
  theme: {
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
  },
  cursorBlink: true,
  cursorStyle: 'bar',
  allowTransparency: true,
  scrollback: 5000,
  smoothScrollDuration: 100,
};
