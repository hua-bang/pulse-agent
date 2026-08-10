import { nextCharIndex, prevCharIndex } from '../terminal/text-width.js';
import { insertAtCursor, nextWordIndex, prevWordIndex, removeAtCursor, removeBeforeCursor, removeWordAfterCursor, removeWordBeforeCursor, verticalCursorTarget } from './composer-edit.js';
import { normalizeInputValue } from './app-format.js';
import type { ComposerState, SlashCommandSuggestion } from './ink-types.js';
import type { FileEntry } from '../shared/file-reference.js';

export interface EditingKeyContext {
  input: string;
  cursor: number;
  recallActive: boolean;
  fileSuggestions: FileEntry[];
  slashSuggestions: SlashCommandSuggestion[];
  setCursor: (value: number | ((current: number) => number)) => void;
  setHistoryIndex: (value: number | null) => void;
  setSelectedFileIndex: (update: (current: number) => number) => void;
  setSelectedSuggestionIndex: (update: (current: number) => number) => void;
  updateComposer: (next: ComposerState) => void;
  showPreviousHistory: () => void;
  showNextHistory: () => void;
}

interface InkKey { [flag: string]: any }

/** Cursor movement, history paging, word/line editing and the default
 *  literal-insert branch — the tail of the composer's key handler. */
export function handleEditingKeys(ctx: EditingKeyContext, value: string, key: InkKey): void {
  const {
    input, cursor, recallActive, fileSuggestions, slashSuggestions,
    setCursor, setHistoryIndex, setSelectedFileIndex, setSelectedSuggestionIndex,
    updateComposer, showPreviousHistory, showNextHistory,
  } = ctx;

  if (key.upArrow) {
    if (!recallActive && fileSuggestions.length > 0) {
      setSelectedFileIndex(current => Math.max(0, Math.min(current, fileSuggestions.length - 1) - 1));
      return;
    }
    if (!recallActive && slashSuggestions.length > 0) {
      setSelectedSuggestionIndex(current => Math.max(0, current - 1));
      return;
    }
    // Inside a multi-line draft, ↑ moves a line before it means "history".
    const upTarget = verticalCursorTarget(input, cursor, -1);
    if (upTarget !== null) {
      setCursor(upTarget);
      return;
    }
    showPreviousHistory();
    return;
  }

  if (key.downArrow) {
    if (!recallActive && fileSuggestions.length > 0) {
      setSelectedFileIndex(current => Math.min(Math.max(0, fileSuggestions.length - 1), current + 1));
      return;
    }
    if (!recallActive && slashSuggestions.length > 0) {
      setSelectedSuggestionIndex(current => Math.min(slashSuggestions.length - 1, current + 1));
      return;
    }
    const downTarget = verticalCursorTarget(input, cursor, 1);
    if (downTarget !== null) {
      setCursor(downTarget);
      return;
    }
    showNextHistory();
    return;
  }

  // Alt+←/→ (xterm sends `\x1b[1;3D`/`\x1b[1;3C`, which ink's parser
  // resolves to key.leftArrow/rightArrow + key.meta — see input-parser.js
  // fnKeyRe) move by word; checked before the plain-arrow fallback below.
  if (key.leftArrow && key.meta) {
    setCursor(current => prevWordIndex(input, current));
    return;
  }

  if (key.rightArrow && key.meta) {
    setCursor(current => nextWordIndex(input, current));
    return;
  }

  if (key.leftArrow) {
    setCursor(current => prevCharIndex(input, current));
    return;
  }

  if (key.rightArrow) {
    setCursor(current => nextCharIndex(input, current));
    return;
  }

  // Home/End (`\x1b[H`/`\x1bOH`/`\x1b[1~` and `\x1b[F`/`\x1bOF`/`\x1b[4~`)
  // resolve to key.home/key.end in ink's parser — same jump as Ctrl+A/E.
  if (key.home) {
    setCursor(0);
    setHistoryIndex(null);
    return;
  }

  if (key.end) {
    setCursor(input.length);
    setHistoryIndex(null);
    return;
  }

  if (key.ctrl && value === 'a') {
    setCursor(0);
    setHistoryIndex(null);
    return;
  }

  if (key.ctrl && value === 'e') {
    setCursor(input.length);
    setHistoryIndex(null);
    return;
  }

  if (key.ctrl && value === 'u') {
    updateComposer({ input: input.slice(cursor), cursor: 0 });
    return;
  }

  if (key.ctrl && value === 'k') {
    updateComposer({ input: input.slice(0, cursor), cursor });
    return;
  }

  if (key.ctrl && value === 'w') {
    updateComposer(removeWordBeforeCursor({ input, cursor }));
    return;
  }

  // Alt+D (ESC d, arrives as value 'd' + key.meta once ink strips the
  // escape prefix) and Ctrl+Delete (`\x1b[3;5~`, resolves to key.delete +
  // key.ctrl) delete the word after the cursor.
  if (key.meta && value === 'd') {
    updateComposer(removeWordAfterCursor({ input, cursor }));
    return;
  }

  if (key.ctrl && key.delete) {
    updateComposer(removeWordAfterCursor({ input, cursor }));
    return;
  }

  if (key.backspace) {
    updateComposer(removeBeforeCursor({ input, cursor }));
    return;
  }

  if (key.delete) {
    updateComposer(removeAtCursor({ input, cursor }));
    return;
  }

  if (value && !key.ctrl && !key.meta) {
    updateComposer(insertAtCursor({ input, cursor }, normalizeInputValue(value)));
  }
}
