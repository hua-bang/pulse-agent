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
import { TranscriptEvent } from './transcript-event.js';

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

  const updateComposer = (next: ComposerState) => {
    setInput(next.input);
    setCursor(clampCursor(next.input, next.cursor));
    setHistoryIndex(null);
  };

  const replaceComposer = (nextInput: string) => {
    setInput(nextInput);
    setCursor(nextInput.length);
  };

  const disarmCtrlC = () => {
    if (ctrlCTimer.current) {
      clearTimeout(ctrlCTimer.current);
      ctrlCTimer.current = null;
    }
    setCtrlCArmed(false);
  };

  const exitApp = () => {
    // Await shutdown so its "saving / goodbye" events reach the transcript
    // before Ink unmounts; a fire-and-forget exit dropped them entirely.
    void (async () => {
      await controller.shutdown();
      // Yield one frame so React commits shutdown's transcript events (Static
      // prints on render, not on state change) before Ink unmounts.
      await new Promise(resolve => setTimeout(resolve, 50));
      onExit?.();
      app.exit();
    })();
  };

  const submitCurrentInput = () => {
    const submitted = input;
    setInput('');
    setCursor(0);
    browsingHistory.current = false;
    setHistory(current => recordHistory(current, submitted));
    if (submitted.trim()) {
      onHistoryRecord?.(submitted.trim());
    }
    setHistoryIndex(null);
    setHistoryDraft('');

    void (async () => {
      await controller.submitInput(submitted);
      const normalized = submitted.trim().toLowerCase();
      if (normalized === 'exit' || normalized === '/exit') {
        onExit?.();
        app.exit();
      }
    })();
  };

  const showPreviousHistory = () => {
    if (history.length === 0) {
      return;
    }

    if (!browsingHistory.current || historyIndex === null) {
      browsingHistory.current = true;
      setHistoryDraft(input);
      setHistoryIndex(history.length - 1);
      replaceComposer(history[history.length - 1]);
      return;
    }

    const nextIndex = Math.max(0, historyIndex - 1);
    setHistoryIndex(nextIndex);
    replaceComposer(history[nextIndex]);
  };

  const showNextHistory = () => {
    if (!browsingHistory.current || historyIndex === null) {
      return;
    }

    const nextIndex = historyIndex + 1;
    if (nextIndex >= history.length) {
      browsingHistory.current = false;
      setHistoryIndex(null);
      replaceComposer(historyDraft);
      setHistoryDraft('');
      return;
    }

    setHistoryIndex(nextIndex);
    replaceComposer(history[nextIndex]);
  };

  const cycleInteractionMode = () => {
    const nextMode = nextInteractionMode(currentInteractionMode);
    void controller.setInteractionMode?.(nextMode, 'shortcut:shift-tab');
  };

  const insertPastedText = (text: string) => {
    const normalized = normalizePastedText(text);
    if (!normalized) {
      return;
    }
    if (snapshot.picker) {
      setPickerQuery(current => `${current}${normalized.replace(/\n+/g, ' ')}`);
      setPickerIndex(0);
      return;
    }
    updateComposer(insertAtCursor({ input, cursor }, normalized));
  };

  usePaste?.(insertPastedText);

  useInput((value, key) => {
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
      if (!recallActive && shouldAcceptSlashSuggestion(input, cursor, selectedSuggestion)) {
        updateComposer(applySlashCommandCompletion(input, cursor, selectedSuggestion.command));
        return;
      }
      submitCurrentInput();
      return;
    }

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
  });

  const terminalRows = terminalSize.rows;
  const terminalColumns = terminalSize.columns;
  // Round border (2) + paddingX (2); the draft additionally carries a '› ' gutter.
  const boxContentColumns = Math.max(1, terminalColumns - 4);
  const promptContentColumns = Math.max(1, boxContentColumns - 2);
  const statusRows = 2; // marginTop + the line itself
  const spinner = SPINNER_FRAMES[spinnerIndex % SPINNER_FRAMES.length];
  const pickerItems = useMemo(() => (picker ? filterPickerItems(picker.items, pickerQuery) : []), [picker, pickerQuery]);
  const clampedPickerIndex = Math.min(pickerIndex, Math.max(0, pickerItems.length - 1));
  // The picker sits below <Static> and shares the screen with the composer, so
  // it is bounded on BOTH axes. Rows: an item with a preview costs two physical
  // rows, not one, so the window must divide by the real per-item height.
  // Columns: label/hint/preview are truncated below — Ink's default wrap would
  // otherwise reflow a long session title onto extra rows and blow the budget
  // this window size just computed.
  //
  // The item budget is what is LEFT once the picker's own fixed rows are paid
  // for, never a flat minimum: a floor of two items pushed a 9-row terminal
  // over the viewport all by itself, which is the clear-and-replay flicker.
  // Border (2) + title + the "… N more" row the window adds as soon as anything
  // scrolls off; +2 for the live region's marginTop and a row of slack so the
  // frame stays strictly under the viewport.
  const pickerRowsPerItem = pickerItems.some(item => item.preview) ? 2 : 1;
  const pickerHintRows = wrappedRowCount(PICKER_HINT, terminalColumns);
  const pickerRowsWithHint = terminalRows - statusRows - 4 - pickerHintRows - 2;
  // Too short for both the hint and one item: keep the item. A picker showing
  // no entries at all cannot be used; the hint only restates the key bindings.
  const showPickerHint = pickerRowsWithHint >= pickerRowsPerItem;
  const pickerItemRows = Math.max(0, showPickerHint ? pickerRowsWithHint : pickerRowsWithHint + pickerHintRows);
  const pickerWindowSize = Math.min(8, Math.floor(pickerItemRows / pickerRowsPerItem));
  const pickerWindowStart = Math.max(0, Math.min(clampedPickerIndex - 2, pickerItems.length - pickerWindowSize));
  const visiblePickerItems = pickerItems.slice(pickerWindowStart, pickerWindowStart + pickerWindowSize);
  // Round border (2) + paddingX (2). Clamped to the REAL inner width, not an
  // arbitrary floor: a floor of 20 exceeds the actual content width on any
  // terminal narrower than 24 columns, which let label/hint/preview truncate
  // against a budget wider than what is actually there — the truncated text
  // still overflows the box and can wrap, blowing the row budget this same
  // width is supposed to keep inside. `4` is a floor only against a
  // degenerate near-zero width, not a claim that 4 columns is usable.
  const pickerContentWidth = Math.max(4, terminalColumns - 4);
  /** Clamps a computed picker-field width so it can never exceed the real inner width, however narrow. */
  const clampToPickerWidth = (value: number) => Math.max(1, Math.min(pickerContentWidth, value));
  const promptLines = useMemo(() => renderPromptLines(input, cursor, true), [cursor, input]);
  // The live region renders PLAIN text, gray — see the render below. Only the
  // final answer segment (finalized into `<Static>` at run end) gets markdown,
  // so streaming no longer pays for a full markdown re-render on every delta;
  // splitting raw text into lines is cheap enough that it does not need its
  // own memo.
  const liveTextLines = snapshot.liveText ? snapshot.liveText.split('\n') : [];
  const slashSuggestions = useMemo(() => getSlashCommandSuggestions(input, cursor, 6, snapshot.skills ?? []), [cursor, input, snapshot.skills]);
  const fileQuery = useMemo(() => detectFileReferenceQuery(input, cursor), [cursor, input]);
  const fileSuggestions = useMemo(
    () => (fileQuery ? filterFileEntries(snapshot.fileIndex ?? [], fileQuery.query) : []),
    [fileQuery, snapshot.fileIndex],
  );
  const normalizedFileIndex = Math.min(selectedFileIndex, Math.max(0, fileSuggestions.length - 1));
  const selectedFile = fileSuggestions[normalizedFileIndex];
  const normalizedSuggestionIndex = Math.min(selectedSuggestionIndex, Math.max(0, slashSuggestions.length - 1));
  const selectedSuggestion = slashSuggestions[normalizedSuggestionIndex];
  const slashSuggestionKey = slashSuggestions.map(item => item.command).join(',');
  useEffect(() => {
    // Reset on any change to the candidate set: clamping on length alone let a
    // stale index point at an unrelated command after the query changed.
    setSelectedSuggestionIndex(0);
  }, [slashSuggestionKey]);
  useEffect(() => {
    setSelectedFileIndex(0);
  }, [fileQuery?.query, fileSuggestions.length]);

  // A PHYSICAL row budget: a draft is bounded by the rows it paints, not by the
  // newlines it contains. `promptContentColumns` is the box content width less
  // the '› ' / '  ' gutter every draft row carries.
  const maxPromptRows = Math.max(1, Math.min(6, terminalRows - 10));
  // Memoized: windowPromptRows() calls wrappedRowCount() per draft row, and a
  // spinner tick (every 120ms while a run is active) re-renders this
  // component without touching the draft — recomputing that wrap on every
  // such tick is pure waste. `promptLines` is itself already memoized on
  // [cursor, input], so this only re-runs when the draft, cursor or the box's
  // measured width actually changes.
  const promptWindow = useMemo(
    () => windowPromptRows(promptLines, maxPromptRows, promptContentColumns),
    [promptLines, maxPromptRows, promptContentColumns],
  );
  const visiblePromptRows = promptWindow.rows;
  const hiddenPromptRowCount = promptWindow.hiddenRowCount;
  const waitingClarification = snapshot.phase === 'Clarification';
  const keyHint = ctrlCArmed
    ? 'Press Ctrl+C again to exit'
    : waitingClarification
      ? 'Clarification · Enter submit answer · Esc cancel'
      : snapshot.isProcessing
        ? 'Esc stop · Enter queues draft · Shift+Tab mode'
        : fileSuggestions.length > 0
          ? '↑↓ select file · Tab/Enter insert · Esc clear'
          : slashSuggestions.length > 0
            ? '↑↓ select · Tab/Enter complete · Esc clear'
          : input.length > 0
            ? 'Enter send · Ctrl+J newline · Esc clear'
            : `/ commands · ↑↓ history · Ctrl+O detail · Ctrl+T narration · Shift+Tab mode (${currentInteractionMode}: ${describeInteractionMode(currentInteractionMode)})`;
  const composerColor = waitingClarification ? 'magenta' : snapshot.isProcessing ? 'yellow' : 'cyan';
  const statusIcon = snapshot.isProcessing ? spinner : '●';
  const statusColor = snapshot.isProcessing ? 'yellow' : snapshot.status === 'Cancelled' ? 'red' : 'green';
  // `statusPrefix` carries Date.now()-derived elapsed time and the spinner
  // glyph — both intentionally recompute every tick, so this stays OUTSIDE
  // the memo below. Its display WIDTH is what statusline's budget actually
  // needs, and that width is stable across spinner ticks (every spinner
  // frame is one column; elapsed text only grows when its digit count does),
  // so deriving the width here and memoizing on the number — not on this
  // string — is what lets the memo skip formatStatusline() on a bare tick.
  const statusPrefix = `${statusIcon} ${snapshot.status}${snapshot.isProcessing && snapshot.runStartedAt ? ` · ${formatElapsed(Date.now() - snapshot.runStartedAt)}` : ''}`;
  const statuslineMaxWidth = Math.max(20, terminalColumns - stringWidth(statusPrefix) - 4);
  // formatStatusline() measures every candidate segment combination with
  // stringWidth(); memoized so a spinner-only re-render (snapshot and
  // statuslineMaxWidth both unchanged) does not redo that work.
  const statusline = useMemo(
    () => formatStatusline(snapshot, statuslineMaxWidth),
    [snapshot, statuslineMaxWidth],
  );

  // Parallel tools (teams, sub-agents) can stack up; window them so the
  // composer never gets pushed off screen.
  const maxLiveTools = Math.max(1, Math.min(5, terminalRows - 14));
  const visibleLiveTools = snapshot.liveTools.slice(-maxLiveTools);
  const hiddenLiveToolCount = snapshot.liveTools.length - visibleLiveTools.length;

  // The live region is the only part without a fixed size, so it gets whatever
  // rows the fixed ones leave over — never more. Ink flips into full-screen
  // clear-and-replay for as long as the live output is taller than the
  // terminal, which is the flicker this budget exists to prevent.
  const liveToolRows = visibleLiveTools.length + (hiddenLiveToolCount > 0 ? 1 : 0);
  // Memoized: the non-picker branch calls wrappedRowCount() once per visible
  // draft row plus once for the key hint, and none of that depends on the
  // spinner — redoing it on every 120ms tick while a run is active was pure
  // waste. Dependencies are the PRIMITIVE/already-memoized inputs, not the
  // intermediate arrays (`visiblePickerItems`, etc.) that this component
  // rebuilds fresh every render regardless — depending on THOSE would defeat
  // the memo, since a fresh `.slice()` never compares equal to the last one.
  // Over-listing is the safer failure mode here (a stale footer height wrongly
  // clips the live region), so every real input reaches this array.
  const footerRows = useMemo(() => (picker
    // Border (2) + title + items + optional "… N more" + the hint line below.
    ? 3 + Math.max(1, visiblePickerItems.length * pickerRowsPerItem)
      + (pickerItems.length > visiblePickerItems.length ? 1 : 0)
      + (showPickerHint ? pickerHintRows : 0)
    // Border (2) + draft rows + optional head + suggestions + the key hint.
    // Draft rows are pre-wrapped to the content width, so each really is one
    // physical row; the hint still wraps and is counted after wrapping.
    : 2 + promptWindow.rows.reduce((rows, line) => rows + wrappedRowCount(line, promptContentColumns), 0)
      + (promptWindow.hiddenRowCount > 0 ? 1 : 0)
      + fileSuggestions.length + slashSuggestions.length
      + wrappedRowCount(keyHint, terminalColumns)
  ), [
    picker,
    visiblePickerItems.length,
    pickerRowsPerItem,
    pickerItems.length,
    showPickerHint,
    pickerHintRows,
    promptWindow,
    promptContentColumns,
    fileSuggestions.length,
    slashSuggestions.length,
    keyHint,
    terminalColumns,
  ]);
  // +1 for the region's own marginTop, +1 so the frame stays strictly under the
  // viewport rather than exactly at it. Running tools are billed first: they
  // are the "what is happening now" signal and the answer can window.
  const maxLiveRegionRows = Math.max(0, terminalRows - (statusRows + footerRows + 2));
  const maxLiveTextRows = maxLiveRegionRows - liveToolRows;
  const liveTextWindow = useMemo(
    () => windowLiveTextLines(liveTextLines, maxLiveTextRows, terminalColumns),
    [liveTextLines, maxLiveTextRows, terminalColumns],
  );
  const hiddenLiveTextCount = liveTextWindow.hiddenLineCount;

  return (
    <Box flexDirection="column">
      <Static items={snapshot.events}>
        {(event: InkCliEvent) => <TranscriptEvent key={event.id} event={event} Box={Box} Text={Text} terminalColumns={terminalColumns} />}
      </Static>

      {/* No visible tail means no room at all — the head alone would just cost
          a row without showing any of the answer.

          Plain text, gray — matching the color a segment gets once a tool
          call finalizes it as narration. Rendering markdown here too used to
          mean every streamed answer flashed bright, then jumped to gray the
          moment a tool call finalized it (or stayed bright if none did,
          which was its own inconsistency). Now the jump happens at most once
          per run, when the final answer lands in `<Static>` with markdown —
          gray while it is provisional, bright once it is the real answer. */}
      {liveTextWindow.lines.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {hiddenLiveTextCount > 0 ? (
            <Text color="gray" dimColor>… {hiddenLiveTextCount} earlier line{hiddenLiveTextCount === 1 ? '' : 's'}</Text>
          ) : null}
          <Text color="gray">{liveTextWindow.lines.join('\n')}</Text>
        </Box>
      ) : null}

      {hiddenLiveToolCount > 0 ? (
        <Text color="gray" dimColor>… {hiddenLiveToolCount} more tool{hiddenLiveToolCount === 1 ? '' : 's'} running</Text>
      ) : null}
      {visibleLiveTools.map(tool => (
        <Text key={tool.id}>
          <Text color="yellow" dimColor>{spinner} </Text>
          <Text color="gray">{truncateLabel(tool.label, terminalColumns - 4)}</Text>
        </Text>
      ))}

      <Box marginTop={1}>
        <Text color={statusColor}>{statusPrefix}</Text>
        <Text color="gray"> · {statusline}</Text>
      </Box>

      {picker ? (
        <Box flexDirection="column">
          <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
            <Text bold color="cyan">{picker.title}{pickerQuery ? <Text color="gray"> · filter: {pickerQuery}</Text> : null}</Text>
            {pickerItems.length === 0 ? (
              <Text color="gray">No matches. Backspace to clear the filter, Esc to cancel.</Text>
            ) : visiblePickerItems.map((item, index) => {
              const actualIndex = pickerWindowStart + index;
              const selected = actualIndex === clampedPickerIndex;
              // Hint gets at most a third of the row; the label takes the rest.
              const hint = truncateLabel(
                `${item.isCurrent ? 'current' : ''}${item.isCurrent && item.hint ? ' · ' : ''}${item.hint ?? ''}`,
                Math.floor(pickerContentWidth / 3),
              );
              const label = truncateLabel(item.label, clampToPickerWidth(pickerContentWidth - 2 - (hint ? stringWidth(hint) + 2 : 0)));
              return (
                <Box key={item.id} flexDirection="column">
                  <Text color={selected ? 'yellow' : undefined}>
                    {selected ? '→ ' : '  '}{label}{hint ? <Text color="gray">  {hint}</Text> : null}
                  </Text>
                  {item.preview ? <Text color="gray" dimColor>    {truncateLabel(item.preview, clampToPickerWidth(pickerContentWidth - 4))}</Text> : null}
                </Box>
              );
            })}
            {pickerItems.length > visiblePickerItems.length ? (
              <Text color="gray">… {pickerItems.length - visiblePickerItems.length} more (↑↓ to scroll)</Text>
            ) : null}
          </Box>
          {showPickerHint ? <Text color="gray">{PICKER_HINT}</Text> : null}
        </Box>
      ) : (
        <Box flexDirection="column">
          <Box borderStyle="round" borderColor={composerColor} paddingX={1} flexDirection="column">
            {hiddenPromptRowCount > 0 ? <Text color="gray">… {hiddenPromptRowCount} earlier draft line{hiddenPromptRowCount === 1 ? '' : 's'}</Text> : null}
            {visiblePromptRows.map((line, index) => (
              <Text key={`${index}-${line}`} color="cyan">
                {index === 0 ? '› ' : '  '}<Text color="white">{line || ' '}</Text>
              </Text>
            ))}
          </Box>

          {fileSuggestions.length > 0 ? (
            <Box flexDirection="column">
              {fileSuggestions.map((entry, index) => (
                <Text key={entry.relPath} color={index === normalizedFileIndex ? 'yellow' : 'gray'}>
                  {index === normalizedFileIndex ? '→ ' : '  '}@{truncateLabel(entry.relPath, terminalColumns - 8)}{entry.isDirectory ? '/' : ''}
                </Text>
              ))}
            </Box>
          ) : null}

          {slashSuggestions.length > 0 ? (
            <Box flexDirection="column">
              {slashSuggestions.map((suggestion, index) => {
                const selected = index === normalizedSuggestionIndex;
                const detail = `${suggestion.group === 'Skill' ? '[skill] ' : ''}${suggestion.description}${selected && suggestion.usage ? ` · ${suggestion.usage}` : ''}`;
                return (
                  <Text key={suggestion.command} color={selected ? 'yellow' : 'gray'}>
                    {selected ? '→ ' : '  '}{suggestion.command}  <Text color="gray">{truncateLabel(detail, Math.max(8, terminalColumns - 4 - stringWidth(suggestion.command)))}</Text>
                  </Text>
                );
              })}
            </Box>
          ) : null}

          <Text color="gray">{keyHint}</Text>
        </Box>
      )}
    </Box>
  );
}
