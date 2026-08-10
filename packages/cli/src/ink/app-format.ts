import { stringWidth, truncateToWidth, wrappedRowCount } from '../terminal/text-width.js';
import { MAX_HISTORY } from './ink-types.js';
import { normalizeInteractionMode } from './composer-hints.js';
import type { CliInteractionMode, InkCliSnapshot } from './ink-types.js';

/** Status-line/token/elapsed formatting and live-region row budgeting. */

export function formatRelativeTime(thenMs: number, nowMs = Date.now()): string {
  const seconds = Math.max(0, Math.floor((nowMs - thenMs) / 1000));
  if (seconds < 60) {
    return 'just now';
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }
  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)}h ago`;
  }
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function formatTokenCount(tokens: number): string {
  if (tokens < 1000) {
    return `${tokens}`;
  }
  if (tokens < 10000) {
    return `${(tokens / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  return `${Math.round(tokens / 1000)}k`;
}

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`;
}

/**
 * Status segments in drop order: the tail is shed first when the line would
 * not fit the terminal, so a narrow window keeps mode/context/model and a wide
 * one still shows everything. Everything dropped here stays available in
 * `/status`.
 */
export function formatStatusline(snapshot: InkCliSnapshot, maxWidth = Number.POSITIVE_INFINITY): string {
  const mode = normalizeInteractionMode(snapshot.mode);
  const contextTokens = snapshot.usageInputTokens > 0 ? snapshot.usageInputTokens : snapshot.estimatedTokens;
  const window = snapshot.contextWindowTokens ?? 0;
  const contextPct = window > 0 && contextTokens > 0 ? ` (${Math.min(999, Math.round(contextTokens / window * 100))}%)` : '';

  const segments = [
    mode,
    `ctx ~${formatTokenCount(contextTokens)}${contextPct}`,
    snapshot.queuedInputs > 0 ? `queue ${snapshot.queuedInputs}` : null,
    snapshot.toolCalls > 0 ? `tools ${snapshot.completedTools}/${snapshot.toolCalls}` : null,
    snapshot.modelLabel ?? null,
    snapshot.usageCachedTokens !== undefined && snapshot.usageInputTokens > 0
      ? `cache ${Math.min(100, Math.round(snapshot.usageCachedTokens / snapshot.usageInputTokens * 100))}%`
      : null,
    snapshot.usageOutputTokens > 0 ? `out ~${formatTokenCount(snapshot.usageOutputTokens)}` : null,
  ].filter((segment): segment is string => Boolean(segment));

  const kept: string[] = [];
  for (const segment of segments) {
    const candidate = [...kept, segment].join(' · ');
    // Display columns, not code units — a CJK/emoji model label is twice as wide
    // as its .length and would push this single line into a wrap.
    if (kept.length > 0 && stringWidth(candidate) > maxWidth) {
      break;
    }
    kept.push(segment);
  }
  return kept.join(' · ');
}

/**
 * Hard-truncates a live tool label so an over-wide line cannot reflow the
 * composer. Measured in display columns, so CJK/emoji labels do not overflow.
 */
export function truncateLabel(label: string, maxWidth: number): string {
  return truncateToWidth(label, maxWidth);
}

export interface LiveTextWindow {
  /** Rendered lines that fit the budget, oldest first. */
  lines: string[];
  /** Lines dropped off the top; > 0 means the "… N earlier lines" head shows. */
  hiddenLineCount: number;
}

/**
 * Keeps the streaming answer inside a row budget.
 *
 * Ink re-prints the WHOLE screen (`clearTerminal` + a replay of the entire
 * static transcript) on every frame whose live output is taller than the
 * terminal, and keeps doing it until the output shrinks back. At streaming
 * frequency that full-screen wipe is exactly the flicker users see, so the
 * live answer shows a bounded tail and the finalized event carries the rest
 * into scrollback.
 *
 * Rows are counted after wrapping (`wrappedRowCount`): a budget that assumed
 * one row per line would be silently blown by the first over-wide paragraph.
 */
export function windowLiveTextLines(lines: string[], maxRows: number, columns: number): LiveTextWindow {
  if (maxRows <= 0 || lines.length === 0) {
    return { lines: [], hiddenLineCount: lines.length };
  }

  // Accumulate from the TAIL, stopping the instant the budget is exceeded,
  // instead of mapping wrappedRowCount() over every line up front. A long
  // answer only ever shows its last `maxRows`-ish rows, so the old
  // map-then-slice paid for every earlier line's wrap cost on every frame —
  // this makes the common case O(visible lines), not O(total lines). Each
  // line costs >= 1 row, so this first pass can never run more than
  // maxRows + 1 iterations even when it does reach the front.
  let used = 0;
  let start = lines.length;
  while (start > 0) {
    const cost = wrappedRowCount(lines[start - 1], columns);
    if (used + cost > maxRows) {
      break;
    }
    used += cost;
    start -= 1;
  }

  if (start === 0) {
    // Walked every line without exceeding the budget: everything fits, no
    // head row needed. Same fast path as before, just reached by counting
    // from the tail instead of summing a fully-mapped cost array.
    return { lines, hiddenLineCount: 0 };
  }

  // Some lines are hidden, so a row is spent on the "… N earlier lines"
  // head — shrink the effective budget by one and drop lines already
  // tentatively included (computed against the looser maxRows above) until
  // the tighter budget holds. At most one extra line comes off here.
  const budget = maxRows - 1;
  while (start < lines.length && used > budget) {
    start += 1;
    used -= wrappedRowCount(lines[start - 1], columns);
  }

  return { lines: lines.slice(start), hiddenLineCount: start };
}

export function describeInteractionMode(mode: CliInteractionMode): string {
  switch (mode) {
    case 'plan':
      return 'engine plan mode: inspect and plan before changes';
    case 'edit':
      return 'engine execute mode: implement and validate';
  }
}

export function normalizeInputValue(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

export function recordHistory(history: string[], submitted: string): string[] {
  const trimmed = submitted.trim();
  if (!trimmed || history[history.length - 1] === trimmed) {
    return history;
  }

  return [...history, trimmed].slice(-MAX_HISTORY);
}
