import { useEffect, useMemo } from 'react';
import { detectFileReferenceQuery, filterFileEntries, type FileEntry } from '../shared/file-reference.js';
import { stringWidth, wrappedRowCount } from '../terminal/text-width.js';
import { PICKER_HINT, SPINNER_FRAMES } from './ink-types.js';
import type { CliInteractionMode, InkCliSnapshot, InkPickerState } from './ink-types.js';
import { filterPickerItems, getSlashCommandSuggestions, renderPromptLines, windowPromptRows } from './composer-hints.js';
import { windowLiveTextLines } from './app-format.js';
import { describeInteractionMode, formatElapsed, formatStatusline } from './app-format.js';

export interface ComposerLayoutArgs {
  terminalSize: { rows: number; columns: number };
  spinnerIndex: number;
  picker: InkPickerState | null;
  pickerQuery: string;
  pickerIndex: number;
  input: string;
  cursor: number;
  snapshot: InkCliSnapshot;
  selectedFileIndex: number;
  selectedSuggestionIndex: number;
  ctrlCArmed: boolean;
  currentInteractionMode: CliInteractionMode;
  setSelectedFileIndex: (value: number) => void;
  setSelectedSuggestionIndex: (value: number) => void;
}

/** Every render-derived value the composer/picker/status JSX consumes —
 *  row/column budgets, suggestion lists, windowed views, status strings.
 *  Bodies are verbatim from the component; hook order is preserved by
 *  calling this unconditionally in the same position every render. */
export function useComposerLayout(args: ComposerLayoutArgs) {
  const {
    terminalSize, spinnerIndex, picker, pickerQuery, pickerIndex, input, cursor, snapshot,
    selectedFileIndex, selectedSuggestionIndex, ctrlCArmed, currentInteractionMode,
    setSelectedFileIndex, setSelectedSuggestionIndex,
  } = args;

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

  return {
    terminalRows,
    terminalColumns,
    boxContentColumns,
    promptContentColumns,
    statusRows,
    spinner,
    pickerItems,
    clampedPickerIndex,
    pickerRowsPerItem,
    pickerHintRows,
    pickerRowsWithHint,
    showPickerHint,
    pickerItemRows,
    pickerWindowSize,
    pickerWindowStart,
    visiblePickerItems,
    pickerContentWidth,
    clampToPickerWidth,
    promptLines,
    liveTextLines,
    slashSuggestions,
    fileQuery,
    fileSuggestions,
    normalizedFileIndex,
    selectedFile,
    normalizedSuggestionIndex,
    selectedSuggestion,
    slashSuggestionKey,
    maxPromptRows,
    promptWindow,
    visiblePromptRows,
    hiddenPromptRowCount,
    waitingClarification,
    keyHint,
    composerColor,
    statusIcon,
    statusColor,
    statusPrefix,
    statuslineMaxWidth,
    statusline,
    maxLiveTools,
    visibleLiveTools,
    hiddenLiveToolCount,
    liveToolRows,
    footerRows,
    maxLiveRegionRows,
    maxLiveTextRows,
    liveTextWindow,
    hiddenLiveTextCount,
  };
}

export type ComposerLayout = ReturnType<typeof useComposerLayout>;
