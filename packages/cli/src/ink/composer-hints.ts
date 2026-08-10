import { stringWidth, truncateToWidth, wrapToRows, wrappedRowCount } from '../terminal/text-width.js';
import { CLI_INTERACTION_MODES, CURSOR_GLYPH, SLASH_COMMANDS } from './ink-types.js';
import { clampCursor } from './composer-edit.js';
import type { CliInteractionMode, ComposerState, InkPickerItem, SlashCommandSuggestion } from './ink-types.js';

/** Prompt rendering windows, paste normalization, slash/picker suggestion logic. */

export function renderPrompt(input: string, cursor: number, cursorVisible: boolean): string {
  return renderPromptLines(input, cursor, cursorVisible).join('\n');
}

export function renderPromptLines(input: string, cursor: number, cursorVisible: boolean): string[] {
  const normalizedCursor = clampCursor(input, cursor);
  const cursorGlyph = cursorVisible ? CURSOR_GLYPH : ' ';
  return `${input.slice(0, normalizedCursor)}${cursorGlyph}${input.slice(normalizedCursor)}`.split('\n');
}

export interface PromptWindow {
  /** Pre-wrapped physical rows to render, in order. */
  rows: string[];
  /** Rows scrolled off the top; > 0 shows the "… N earlier draft lines" head. */
  hiddenRowCount: number;
}

/**
 * Keeps the draft inside a PHYSICAL row budget.
 *
 * The composer shares the screen with everything else below `<Static>`, so its
 * height is bounded the same way the live region is — and a budget counting
 * LOGICAL lines is not a bound at all: one pasted URL is a single logical line
 * and thirty physical rows, which on its own puts the frame over the viewport
 * and drops Ink into clear-and-replay on every keystroke.
 *
 * The rows are wrapped HERE and rendered one `<Text>` per row: each row fits
 * `columns`, so Ink cannot reflow it and the budget cannot be blown behind its
 * back. The window is anchored on the cursor's row rather than on the tail —
 * editing at the top of a long paste must still show what is being edited.
 */
export function windowPromptRows(lines: string[], maxRows: number, columns: number): PromptWindow {
  const rows = lines.flatMap(line => wrapToRows(line, columns));
  const budget = Math.max(1, maxRows);
  if (rows.length <= budget) {
    return { rows, hiddenRowCount: 0 };
  }

  const cursorRow = rows.findIndex(row => row.includes(CURSOR_GLYPH));
  const anchor = cursorRow >= 0 ? cursorRow : rows.length - 1;
  const start = Math.max(0, Math.min(anchor + 1 - budget, rows.length - budget));
  return { rows: rows.slice(start, start + budget), hiddenRowCount: start };
}

/**
 * Multi-character `useInput` values only occur when the terminal delivered a
 * chunk (non-bracketed paste or coalesced typing). Those must be inserted
 * literally — never interpreted as Enter/Tab — or a paste containing a
 * newline would submit the draft mid-paste.
 */
export function isPasteChunk(value: string): boolean {
  return typeof value === 'string' && value.length > 1;
}

export function normalizePastedText(value: string): string {
  return value.replace(/\x1b\[20[01]~/g, '').replace(/\r\n?/g, '\n');
}

export function getSlashCommandSuggestions(
  input: string,
  cursor: number,
  limit = 6,
  skills: Array<{ name: string; description: string }> = [],
): SlashCommandSuggestion[] {
  const normalizedCursor = clampCursor(input, cursor);
  const beforeCursor = input.slice(0, normalizedCursor);
  if (!beforeCursor.startsWith('/') || beforeCursor.startsWith('//') || beforeCursor.includes('\n')) {
    return [];
  }

  const match = beforeCursor.match(/^\/([^\s/]*)$/);
  if (!match) {
    return [];
  }

  const query = match[1].toLowerCase();
  // Built-ins first so a skill can never shadow a real command; skills whose
  // name collides with a built-in are dropped (they stay reachable via
  // `/skills <name> <message>`).
  const builtInNames = new Set(SLASH_COMMANDS.map(item => item.command.slice(1).toLowerCase()));
  const skillEntries: SlashCommandSuggestion[] = skills
    .filter(skill => !builtInNames.has(skill.name.toLowerCase()))
    .map(skill => ({
      command: `/${skill.name}`,
      description: skill.description,
      usage: `/${skill.name} <message>`,
      group: 'Skill',
    }));

  return [...SLASH_COMMANDS, ...skillEntries]
    .map((item, index) => ({ item, index, score: scoreSlashCommand(item.command.slice(1), query) }))
    .filter(match => match.score >= 0)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map(match => match.item)
    .slice(0, limit);
}

export function shouldAcceptSlashSuggestion(input: string, cursor: number, suggestion?: SlashCommandSuggestion): boolean {
  if (!suggestion) {
    return false;
  }

  const normalizedCursor = clampCursor(input, cursor);
  const beforeCursor = input.slice(0, normalizedCursor);
  const match = beforeCursor.match(/^\/([^\s/]*)$/);
  if (!match) {
    return false;
  }

  return beforeCursor !== suggestion.command;
}

function scoreSlashCommand(commandName: string, query: string): number {
  if (query.length === 0) {
    return 0;
  }
  if (commandName.startsWith(query)) {
    return 0;
  }
  const containsIndex = commandName.indexOf(query);
  if (containsIndex >= 0) {
    return 100 + containsIndex;
  }
  if (isSubsequence(query, commandName)) {
    return 200 + commandName.length;
  }
  return -1;
}

function isSubsequence(query: string, value: string): boolean {
  let queryIndex = 0;
  for (const char of value) {
    if (char === query[queryIndex]) {
      queryIndex += 1;
      if (queryIndex === query.length) {
        return true;
      }
    }
  }
  return query.length === 0;
}

export function applySlashCommandCompletion(input: string, cursor: number, command: string): ComposerState {
  const normalizedCursor = clampCursor(input, cursor);
  const beforeCursor = input.slice(0, normalizedCursor);
  if (!beforeCursor.match(/^\/([^\s/]*)$/)) {
    return { input, cursor: normalizedCursor };
  }

  const suffix = input.slice(normalizedCursor);
  const completed = `${command} `;
  return {
    input: `${completed}${suffix}`,
    cursor: completed.length,
  };
}

export function nextInteractionMode(mode: string | null | undefined): CliInteractionMode {
  const currentIndex = CLI_INTERACTION_MODES.indexOf(normalizeInteractionMode(mode));
  return CLI_INTERACTION_MODES[(currentIndex + 1) % CLI_INTERACTION_MODES.length];
}

export function normalizeInteractionMode(mode: string | null | undefined): CliInteractionMode {
  if (mode === 'plan' || mode === 'planning') {
    return 'plan';
  }
  return 'edit';
}

export function filterPickerItems(items: InkPickerItem[], query: string): InkPickerItem[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return items;
  }
  return items.filter(item =>
    `${item.label} ${item.hint ?? ''} ${item.preview ?? ''}`.toLowerCase().includes(normalized));
}

