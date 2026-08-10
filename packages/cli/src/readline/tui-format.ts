/** Pure ANSI/text formatting for the readline TUI renderer. */

export const RESET = '\u001b[0m';
export const DIM = '\u001b[2m';
export const BOLD = '\u001b[1m';
export const CYAN = '\u001b[36m';
export const GREEN = '\u001b[32m';
export const YELLOW = '\u001b[33m';
export const RED = '\u001b[31m';
export const MAGENTA = '\u001b[35m';

export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

type Colorize = (value: string, code: string) => string;

export function renderBox(title: string, lines: string[], color: Colorize, columns?: number): string {
  const visibleLines = lines.map(line => stripAnsi(line));
  const maxLineLength = Math.max(title.length + 2, ...visibleLines.map(line => line.length));
  const maxWidth = Math.max(42, Math.min(columns ?? 80, 96) - 4);
  const width = Math.min(Math.max(maxLineLength, 42), maxWidth);
  const top = `╭─ ${color(title, BOLD)} ${'─'.repeat(Math.max(0, width - title.length - 3))}╮`;
  const bottom = `╰${'─'.repeat(width + 2)}╯`;
  const body = lines.flatMap(line => wrapVisible(line, width)).map(line => {
    const padding = width - stripAnsi(line).length;
    return `│ ${line}${' '.repeat(Math.max(0, padding))} │`;
  });

  return [top, ...body, bottom].join('\n');
}

function wrapVisible(line: string, width: number): string[] {
  if (stripAnsi(line).length <= width) {
    return [line];
  }

  const plain = stripAnsi(line);
  const wrapped: string[] = [];
  for (let index = 0; index < plain.length; index += width) {
    wrapped.push(plain.slice(index, index + width));
  }
  return wrapped;
}

export function formatToolInput(value: unknown): string[] {
  const maxLineLength = 96;
  const maxLines = 4;
  const json = safeJson(value);
  const pretty = prettyJson(value) ?? json;
  const sourceLines = pretty.split('\n');
  const lines: string[] = [];

  for (const sourceLine of sourceLines) {
    const trimmed = sourceLine.trimEnd();
    if (!trimmed) {
      continue;
    }
    lines.push(truncate(trimmed, maxLineLength));
    if (lines.length >= maxLines) {
      break;
    }
  }

  if (sourceLines.length > maxLines || json.length > lines.join('\n').length) {
    const remaining = Math.max(0, json.length - lines.join('\n').length);
    lines.push(`… truncated ${remaining} chars`);
  }

  return lines;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function prettyJson(value: unknown): string | null {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return null;
  }
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

export function formatDuration(ms: number): string {
  if (ms < 1_000) {
    return `${Math.max(0, Math.round(ms))}ms`;
  }

  const seconds = ms / 1_000;
  if (seconds < 60) {
    return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
}
