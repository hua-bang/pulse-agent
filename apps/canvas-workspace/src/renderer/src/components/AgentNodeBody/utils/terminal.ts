import { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import { BASE_TERMINAL_FONT_SIZE } from '../../../config/terminalTheme';
import { count } from '../../../perf/counters';

export const SCROLLBACK_SAVE_INTERVAL = 2000;
export const MAX_SCROLLBACK_CHARS = 50000;

/** localStorage key for recently-used working directories across all agent nodes. */
export const RECENT_CWDS_KEY = 'canvas-workspace:recent-cwds';
export const MAX_RECENT_CWDS = 5;

export const loadRecentCwds = (): string[] => {
  try {
    const raw = localStorage.getItem(RECENT_CWDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

export const pushRecentCwd = (cwd: string): string[] => {
  const current = loadRecentCwds().filter((c) => c !== cwd);
  const next = [cwd, ...current].slice(0, MAX_RECENT_CWDS);
  try {
    localStorage.setItem(RECENT_CWDS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
};

export const serializeBuffer = (term: Terminal): string => {
  const buf = term.buffer.active;
  const lines: string[] = [];
  const count = buf.length;
  for (let i = 0; i < count; i++) {
    const line = buf.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }
  let text = lines.join('\n');
  text = text.replace(/\n+$/, '');
  if (text.length > MAX_SCROLLBACK_CHARS) text = text.slice(-MAX_SCROLLBACK_CHARS);
  return text;
};

/** Truncate a path for display, keeping the last N segments. */
export const truncatePath = (p: string, maxLen = 36): string => {
  if (p.length <= maxLen) return p;
  const parts = p.replace(/\/$/, '').split('/');
  let result = parts[parts.length - 1];
  for (let i = parts.length - 2; i >= 0; i--) {
    const next = parts[i] + '/' + result;
    if (next.length > maxLen) return '\u2026/' + result;
    result = next;
  }
  return result;
};

/** Read the cascading `--canvas-scale` CSS variable injected by
 *  `CanvasSurface` onto `.canvas-transform`. Falls back to 1 when the
 *  element is detached or the var is missing/invalid. */
export const readCanvasScale = (el: HTMLElement | null | undefined): number => {
  if (!el) return 1;
  const raw = getComputedStyle(el).getPropertyValue('--canvas-scale').trim();
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 1;
};

/** Keep the xterm font size in lock-step with the canvas zoom so the
 *  visual text size scales with the rest of the canvas while the xterm
 *  subtree stays in a net `transform: 1` coordinate space (thanks to the
 *  inverse-scale wrapper in the matching CSS). The combination lets
 *  selection math stay self-consistent and gives users a true zoom on the
 *  glyph size. Returns true when the font size was actually changed so
 *  callers can decide whether to re-fit. */
export const syncTerminalFontSizeToCanvas = (
  term: Terminal | null,
  containerEl: HTMLElement | null | undefined,
): boolean => {
  if (!term) return false;
  const scale = readCanvasScale(containerEl);
  const next = BASE_TERMINAL_FONT_SIZE * scale;
  if (term.options.fontSize === next) return false;
  term.options.fontSize = next;
  return true;
};

/** Convenience wrapper: sync font size to canvas scale, then re-fit. */
export const fitTerminalWithCanvasScale = (
  term: Terminal | null,
  fit: FitAddon | null,
  containerEl: HTMLElement | null | undefined,
): void => {
  count('terminal-fit');
  syncTerminalFontSizeToCanvas(term, containerEl);
  try { fit?.fit(); } catch { /* ignore */ }
};

/** Trailing debounce for ResizeObserver-driven terminal refits (perf
 *  finding E2). A refit re-measures glyphs, reallocates xterm's render
 *  canvases, and can emit a `pty:resize` IPC — running that once per
 *  animation frame for every terminal while the canvas fit animation
 *  transitions `--canvas-scale` (or while the user drag-resizes a node)
 *  froze the renderer. One trailing refit after the burst settles is
 *  visually equivalent: mid-burst the terminal is stretching anyway. */
export const TERMINAL_REFIT_DEBOUNCE_MS = 120;

export const createDebouncedTerminalRefit = (
  refit: () => void,
): { schedule: () => void; cancel: () => void } => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule: () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        refit();
      }, TERMINAL_REFIT_DEBOUNCE_MS);
    },
    cancel: () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
};
