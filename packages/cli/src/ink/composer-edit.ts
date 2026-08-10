import { nextCharIndex, prevCharIndex } from '../terminal/text-width.js';
import type { ComposerState } from './ink-types.js';

/** Pure composer editing: cursor-safe insert/delete and word navigation. */

export function clampCursor(input: string, cursor: number): number {
  return Math.max(0, Math.min(input.length, cursor));
}

export function insertAtCursor(state: ComposerState, value: string): ComposerState {
  const cursor = clampCursor(state.input, state.cursor);
  return {
    input: `${state.input.slice(0, cursor)}${value}${state.input.slice(cursor)}`,
    cursor: cursor + value.length,
  };
}

export function removeBeforeCursor(state: ComposerState): ComposerState {
  const cursor = clampCursor(state.input, state.cursor);
  if (cursor === 0) {
    return { input: state.input, cursor };
  }

  const start = prevCharIndex(state.input, cursor);
  return {
    input: `${state.input.slice(0, start)}${state.input.slice(cursor)}`,
    cursor: start,
  };
}

export function removeAtCursor(state: ComposerState): ComposerState {
  const cursor = clampCursor(state.input, state.cursor);
  if (cursor >= state.input.length) {
    return { input: state.input, cursor };
  }

  return {
    input: `${state.input.slice(0, cursor)}${state.input.slice(nextCharIndex(state.input, cursor))}`,
    cursor,
  };
}

export function removeWordBeforeCursor(state: ComposerState): ComposerState {
  const cursor = clampCursor(state.input, state.cursor);
  if (cursor === 0) {
    return { input: state.input, cursor };
  }

  const beforeCursor = state.input.slice(0, cursor);
  const afterCursor = state.input.slice(cursor);
  const wordStart = beforeCursor.replace(/\s+$/, '').search(/\S+$/);
  const deleteFrom = wordStart === -1 ? 0 : wordStart;
  return {
    input: `${beforeCursor.slice(0, deleteFrom)}${afterCursor}`,
    cursor: deleteFrom,
  };
}

/**
 * Index one word forward of `cursor` (Alt+→): skip whitespace, then eat
 * non-whitespace — the mirror of `removeWordBeforeCursor`'s boundary search.
 *
 * Bounded to the CURRENT LINE: a multi-line draft must not let a word step
 * eat the newline as if it were ordinary whitespace (that would silently
 * splice two lines together from the caller's point of view). Sitting
 * exactly on a line boundary still makes progress — it steps over the single
 * `\n`, the same one-row-at-a-time contract `verticalCursorTarget` keeps for
 * vertical movement — so repeated presses can never get stuck.
 */
export function nextWordIndex(input: string, cursor: number): number {
  const position = clampCursor(input, cursor);
  if (position >= input.length) {
    return position;
  }
  if (input[position] === '\n') {
    return position + 1;
  }

  const lineBreak = input.indexOf('\n', position);
  const boundary = lineBreak === -1 ? input.length : lineBreak;
  const match = input.slice(position, boundary).match(/^\s*\S*/);
  const consumed = match ? match[0].length : 0;
  if (consumed > 0) {
    return position + consumed;
  }
  // Nothing left on this line (cursor already sits at its end): step over the
  // newline that ends it, if there is one, rather than standing still.
  return boundary < input.length ? boundary + 1 : position;
}

/**
 * Index one word back of `cursor` (Alt+←): the same boundary search
 * `removeWordBeforeCursor` uses, exposed for cursor movement and bounded to
 * the current line for the same reason `nextWordIndex` is.
 */
export function prevWordIndex(input: string, cursor: number): number {
  const position = clampCursor(input, cursor);
  if (position <= 0) {
    return 0;
  }
  if (input[position - 1] === '\n') {
    return position - 1;
  }

  const lineStart = input.lastIndexOf('\n', position - 1) + 1;
  const segment = input.slice(lineStart, position);
  const wordStart = segment.replace(/\s+$/, '').search(/\S+$/);
  return lineStart + (wordStart === -1 ? 0 : wordStart);
}

/**
 * Deletes the word after the cursor (Alt+D, Ctrl+Delete) — the forward twin
 * of `removeWordBeforeCursor`.
 *
 * Unlike `nextWordIndex` (cursor movement, where stepping over a lone `\n`
 * is the correct way to make progress at a line's end) a delete must NEVER
 * consume that newline itself — doing so would splice two draft lines
 * together, which is a content change `verticalCursorTarget`'s row-by-row
 * model does not expect. So this stops at the line boundary and deletes
 * nothing when the cursor already sits there.
 */
export function removeWordAfterCursor(state: ComposerState): ComposerState {
  const cursor = clampCursor(state.input, state.cursor);
  if (cursor >= state.input.length || state.input[cursor] === '\n') {
    return { input: state.input, cursor };
  }

  const lineBreak = state.input.indexOf('\n', cursor);
  const boundary = lineBreak === -1 ? state.input.length : lineBreak;
  const match = state.input.slice(cursor, boundary).match(/^\s*\S*/);
  const consumed = match ? match[0].length : 0;
  if (consumed === 0) {
    return { input: state.input, cursor };
  }

  const deleteTo = cursor + consumed;
  return {
    input: `${state.input.slice(0, cursor)}${state.input.slice(deleteTo)}`,
    cursor,
  };
}

/**
 * Target index one line up/down inside a multi-line draft, preserving the
 * column. Returns null when there is no such line — the caller then falls
 * through to history navigation, so ↑/↓ keeps working on a single-line draft.
 */
export function verticalCursorTarget(input: string, cursor: number, direction: -1 | 1): number | null {
  if (!input.includes('\n')) {
    return null;
  }

  const position = clampCursor(input, cursor);
  const lineStart = input.lastIndexOf('\n', position - 1) + 1;
  const column = position - lineStart;

  if (direction === -1) {
    if (lineStart === 0) {
      return null;
    }
    const prevStart = input.lastIndexOf('\n', lineStart - 2) + 1;
    const prevLength = lineStart - 1 - prevStart;
    return prevStart + Math.min(column, prevLength);
  }

  const lineEnd = input.indexOf('\n', position);
  if (lineEnd === -1) {
    return null;
  }
  const nextStart = lineEnd + 1;
  const nextEnd = input.indexOf('\n', nextStart);
  const nextLength = (nextEnd === -1 ? input.length : nextEnd) - nextStart;
  return nextStart + Math.min(column, nextLength);
}

