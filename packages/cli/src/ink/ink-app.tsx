import React, { useEffect, useMemo, useRef, useState } from 'react';

import { renderMarkdownAnsi } from '../terminal/markdown.js';
import { applyFileReference, detectFileReferenceQuery, filterFileEntries, type FileEntry } from '../shared/file-reference.js';
import { nextCharIndex, prevCharIndex, stringWidth, truncateToWidth, wrappedRowCount, wrapToRows } from '../terminal/text-width.js';

import {
  CTRL_C_CONFIRM_WINDOW_MS, DEFAULT_SNAPSHOT, MAX_HISTORY, PICKER_HINT, SPINNER_FRAMES,
} from './ink-types.js';
import type { ComposerState, InkCliAppProps, InkCliEvent, InkCliSnapshot } from './ink-types.js';
import {
  formatElapsed, formatRelativeTime, formatStatusline, formatTokenCount,
  normalizeInputValue, recordHistory, truncateLabel, windowLiveTextLines,
} from './app-format.js';
import { clampCursor, insertAtCursor, removeAtCursor, removeBeforeCursor, removeWordAfterCursor, removeWordBeforeCursor, nextWordIndex, prevWordIndex, verticalCursorTarget } from './composer-edit.js';
import {
  applySlashCommandCompletion, filterPickerItems, getSlashCommandSuggestions, isPasteChunk,
  nextInteractionMode, normalizeInteractionMode, normalizePastedText, renderPromptLines,
  shouldAcceptSlashSuggestion, windowPromptRows,
} from './composer-hints.js';
import { describeInteractionMode } from './app-format.js';
import { buildComposerActions } from './composer-actions.js';
import { buildKeyHandler } from './app-input.js';
import { useComposerLayout } from './use-composer-layout.js';
import { AppView } from './app-view.js';

// Façade: every Ink-host consumer imports types and helpers from this module;
// implementations live in ink-types / composer-edit / composer-hints /
// app-format / transcript-event.
export * from './ink-types.js';
export * from './composer-edit.js';
export * from './composer-hints.js';
export * from './app-format.js';

export function InkCliApp({ controller, runtime, onExit, initialHistory, onHistoryRecord }: InkCliAppProps) {
  const { Box, Text, Static, useApp, useInput, usePaste, useStdout } = runtime;
  const [snapshot, setSnapshot] = useState<InkCliSnapshot>(() => ({
    ...DEFAULT_SNAPSHOT,
    ...controller.getSnapshot(),
  }));
  const [input, setInput] = useState('');
  const [cursor, setCursor] = useState(0);
  const [history, setHistory] = useState<string[]>(() => (initialHistory ?? []).slice(-MAX_HISTORY));
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [historyDraft, setHistoryDraft] = useState('');
  // Browsing is its own state: historyIndex is cleared by ordinary edits and
  // cursor moves, which must NOT restart the browse (that re-captured the
  // draft from already-loaded history text and stuck ↑ on the newest entry).
  const browsingHistory = useRef(false);
  const [spinnerIndex, setSpinnerIndex] = useState(0);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [pickerIndex, setPickerIndex] = useState(0);
  const [pickerQuery, setPickerQuery] = useState('');
  const [ctrlCArmed, setCtrlCArmed] = useState(false);
  const ctrlCTimer = useRef<NodeJS.Timeout | null>(null);
  const app = useApp();
  const { stdout } = useStdout();
  // Ink's resize handling re-lays-out the committed tree but never re-renders
  // the component, so width/height-derived math would go stale. Mirror the
  // size into state and subscribe to 'resize' ourselves.
  const [terminalSize, setTerminalSize] = useState(() => ({ rows: stdout.rows ?? 30, columns: stdout.columns ?? 80 }));
  useEffect(() => {
    if (typeof stdout.on !== 'function') {
      return;
    }
    const onResize = () => setTerminalSize({ rows: stdout.rows ?? 30, columns: stdout.columns ?? 80 });
    stdout.on('resize', onResize);
    return () => stdout.off?.('resize', onResize);
  }, [stdout]);
  const currentInteractionMode = normalizeInteractionMode(snapshot.mode);

  useEffect(() => controller.subscribe(setSnapshot), [controller]);

  const picker = snapshot.picker ?? null;
  useEffect(() => {
    // Land on the active entry when the picker knows one, so /model opens on the
    // model you are already using instead of always on item 0.
    const current = picker?.items.findIndex(item => item.isCurrent) ?? -1;
    setPickerIndex(current >= 0 ? current : 0);
    setPickerQuery('');
  }, [picker]);

  useEffect(() => {
    if (!snapshot.isProcessing) {
      return;
    }

    const timer = setInterval(() => setSpinnerIndex(current => current + 1), 120);
    return () => clearInterval(timer);
  }, [snapshot.isProcessing]);

  useEffect(() => () => {
    if (ctrlCTimer.current) {
      clearTimeout(ctrlCTimer.current);
    }
  }, []);

  const {
    updateComposer, disarmCtrlC, exitApp, submitCurrentInput,
    showPreviousHistory, showNextHistory, cycleInteractionMode, insertPastedText,
  } = buildComposerActions({
    controller, snapshot, input, cursor, history, historyIndex, historyDraft,
    browsingHistory, ctrlCTimer, currentInteractionMode, app, onExit, onHistoryRecord,
    setInput, setCursor, setHistory, setHistoryIndex, setHistoryDraft, setCtrlCArmed,
    setPickerQuery, setPickerIndex,
  });

  usePaste?.(insertPastedText);

  const layout = useComposerLayout({
    terminalSize, spinnerIndex, picker, pickerQuery, pickerIndex, input, cursor, snapshot,
    selectedFileIndex, selectedSuggestionIndex, ctrlCArmed, currentInteractionMode,
    setSelectedFileIndex, setSelectedSuggestionIndex,
  });
  const {
    pickerItems, clampedPickerIndex, selectedFile, selectedSuggestion,
    fileSuggestions, slashSuggestions,
  } = layout;

  useInput(buildKeyHandler({
    controller, snapshot, input, cursor, historyIndex, browsingHistory, ctrlCArmed, ctrlCTimer,
    pickerItems, clampedPickerIndex, selectedFile, selectedSuggestion, fileSuggestions, slashSuggestions,
    setInput, setCursor, setHistoryIndex, setHistoryDraft, setCtrlCArmed, setPickerIndex, setPickerQuery,
    setSelectedFileIndex, setSelectedSuggestionIndex,
    updateComposer, disarmCtrlC, exitApp, submitCurrentInput, showPreviousHistory, showNextHistory,
    cycleInteractionMode, insertPastedText,
  }));

  return (
    <AppView
      layout={layout}
      snapshot={snapshot}
      input={input}
      ctrlCArmed={ctrlCArmed}
      picker={picker}
      pickerQuery={pickerQuery}
      Box={Box}
      Text={Text}
      Static={Static}
    />
  );
}
