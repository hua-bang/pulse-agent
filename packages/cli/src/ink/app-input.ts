import type { MutableRefObject } from 'react';
import { applyFileReference, type FileEntry } from '../shared/file-reference.js';
import { insertAtCursor } from './composer-edit.js';
import { applySlashCommandCompletion, isPasteChunk, shouldAcceptSlashSuggestion } from './composer-hints.js';
import { normalizeInputValue } from './app-format.js';
import { CTRL_C_CONFIRM_WINDOW_MS } from './ink-types.js';
import { handleEditingKeys } from './composer-keys.js';
import type { ComposerState, InkCliController, InkCliSnapshot, InkPickerItem, SlashCommandSuggestion } from './ink-types.js';

export interface ComposerKeyContext {
  controller: InkCliController;
  snapshot: InkCliSnapshot;
  input: string;
  cursor: number;
  historyIndex: number | null;
  browsingHistory: MutableRefObject<boolean>;
  ctrlCArmed: boolean;
  ctrlCTimer: MutableRefObject<NodeJS.Timeout | null>;
  pickerItems: InkPickerItem[];
  clampedPickerIndex: number;
  selectedFile: FileEntry | undefined;
  selectedSuggestion: SlashCommandSuggestion | undefined;
  fileSuggestions: FileEntry[];
  slashSuggestions: SlashCommandSuggestion[];
  setInput: (value: string) => void;
  setCursor: (value: number | ((current: number) => number)) => void;
  setHistoryIndex: (value: number | null) => void;
  setHistoryDraft: (value: string) => void;
  setCtrlCArmed: (value: boolean) => void;
  setPickerIndex: (update: number | ((current: number) => number)) => void;
  setPickerQuery: (update: string | ((current: string) => string)) => void;
  setSelectedFileIndex: (update: (current: number) => number) => void;
  setSelectedSuggestionIndex: (update: (current: number) => number) => void;
  updateComposer: (next: ComposerState) => void;
  disarmCtrlC: () => void;
  exitApp: () => void;
  submitCurrentInput: () => void;
  showPreviousHistory: () => void;
  showNextHistory: () => void;
  cycleInteractionMode: () => void;
  insertPastedText: (text: string) => void;
}

interface InkKey { [flag: string]: any }

/** Builds the composer's useInput callback for the current render — bodies
 *  are verbatim from the previous inline handler; the editing-key tail
 *  delegates to handleEditingKeys(). */
export function buildKeyHandler(ctx: ComposerKeyContext): (value: string, key: InkKey) => void {
  const {
    controller, snapshot, input, cursor, historyIndex, browsingHistory, ctrlCArmed, ctrlCTimer,
    pickerItems, clampedPickerIndex, selectedFile, selectedSuggestion, fileSuggestions, slashSuggestions,
    setInput, setCursor, setHistoryIndex, setHistoryDraft, setCtrlCArmed, setPickerIndex, setPickerQuery,
    setSelectedFileIndex, setSelectedSuggestionIndex,
    updateComposer, disarmCtrlC, exitApp, submitCurrentInput, showPreviousHistory, showNextHistory,
    cycleInteractionMode, insertPastedText,
  } = ctx;

  return (value, key) => {
  if (key.ctrl && value === 'c') {
    if (ctrlCArmed) {
      disarmCtrlC();
      exitApp();
      return;
    }

    if (input.length > 0) {
      setInput('');
      setCursor(0);
      setHistoryIndex(null);
      setHistoryDraft('');
    }
    setCtrlCArmed(true);
    ctrlCTimer.current = setTimeout(() => {
      ctrlCTimer.current = null;
      setCtrlCArmed(false);
    }, CTRL_C_CONFIRM_WINDOW_MS);
    return;
  }

  disarmCtrlC();

  // Modal picker (e.g. /resume): captures all keys until resolved.
  if (snapshot.picker) {
    if (key.escape) {
      controller.pickerCancel?.();
      return;
    }
    if (key.return) {
      const item = pickerItems[clampedPickerIndex];
      if (item) {
        controller.pickerSelect?.(item.id);
      }
      return;
    }
    if (key.upArrow) {
      setPickerIndex(current => Math.max(0, Math.min(current, pickerItems.length - 1) - 1));
      return;
    }
    if (key.downArrow) {
      setPickerIndex(current => Math.min(Math.max(0, pickerItems.length - 1), current + 1));
      return;
    }
    if (key.backspace || key.delete) {
      setPickerQuery(current => current.slice(0, -1));
      setPickerIndex(0);
      return;
    }
    if (value && !key.ctrl && !key.meta && !key.tab) {
      setPickerQuery(current => `${current}${normalizeInputValue(value).replace(/\n+/g, ' ')}`);
      setPickerIndex(0);
    }
    return;
  }

  // Chunked input (paste on terminals without bracketed paste, coalesced
  // typing) must be inserted literally before any key interpretation.
  if (isPasteChunk(value) && !key.ctrl && !key.meta) {
    insertPastedText(value);
    return;
  }

  if (key.escape) {
    if (snapshot.isProcessing) {
      controller.requestStop();
      return;
    }

    if (input.length > 0) {
      browsingHistory.current = false;
      setInput('');
      setCursor(0);
      setHistoryIndex(null);
      setHistoryDraft('');
    }
    return;
  }

  if (key.shift && (key.tab || value === '\t')) {
    cycleInteractionMode();
    return;
  }

  if (key.tab || value === '\t') {
    if (selectedFile) {
      updateComposer(applyFileReference(input, cursor, selectedFile.relPath + (selectedFile.isDirectory ? '/' : '')));
      return;
    }
    if (selectedSuggestion) {
      updateComposer(applySlashCommandCompletion(input, cursor, selectedSuggestion.command));
    }
    return;
  }

  if (key.ctrl && value === 'o') {
    controller.toggleToolDetail?.();
    return;
  }

  if (key.ctrl && value === 't') {
    controller.toggleNarrationCollapse?.();
    return;
  }

  if (key.ctrl && (value === 'j' || value === '\n')) {
    updateComposer(insertAtCursor({ input, cursor }, '\n'));
    return;
  }

  // A recalled history entry may itself be a slash command (or end in an
  // `@path` fragment), which opens the matching suggestion palette. While
  // the browse is active those palettes must NOT capture ↑/↓/Enter — the
  // arrows keep paging history and Enter resubmits the recalled text
  // verbatim. Any edit clears historyIndex, handing the keys back to the
  // palettes; Tab still completes explicitly either way.
  const recallActive = browsingHistory.current && historyIndex !== null;

  if (key.return) {
    if (!recallActive && selectedFile) {
      updateComposer(applyFileReference(input, cursor, selectedFile.relPath + (selectedFile.isDirectory ? '/' : '')));
      return;
    }
    if (!recallActive && selectedSuggestion && shouldAcceptSlashSuggestion(input, cursor, selectedSuggestion)) {
      updateComposer(applySlashCommandCompletion(input, cursor, selectedSuggestion.command));
      return;
    }
    submitCurrentInput();
    return;
  }

    handleEditingKeys({
      input, cursor, recallActive, fileSuggestions, slashSuggestions,
      setCursor, setHistoryIndex, setSelectedFileIndex, setSelectedSuggestionIndex,
      updateComposer, showPreviousHistory, showNextHistory,
    }, value, key);
  };
}
