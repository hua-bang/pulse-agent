import type { ITerminalOptions } from '@xterm/xterm';

export const BASE_TERMINAL_FONT_SIZE = 12;

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
