import type { MutableRefObject } from 'react';
import { clampCursor, insertAtCursor } from './composer-edit.js';
import { recordHistory } from './app-format.js';
import { nextInteractionMode, normalizePastedText } from './composer-hints.js';
import type { CliInteractionMode, ComposerState, InkCliController, InkCliSnapshot } from './ink-types.js';

export interface ComposerActionContext {
  controller: InkCliController;
  snapshot: InkCliSnapshot;
  input: string;
  cursor: number;
  history: string[];
  historyIndex: number | null;
  historyDraft: string;
  browsingHistory: MutableRefObject<boolean>;
  ctrlCTimer: MutableRefObject<NodeJS.Timeout | null>;
  currentInteractionMode: CliInteractionMode;
  app: { exit: () => void };
  onExit?: () => void;
  onHistoryRecord?: (entry: string) => void;
  setInput: (value: string) => void;
  setCursor: (value: number | ((current: number) => number)) => void;
  setHistory: (update: (current: string[]) => string[]) => void;
  setHistoryIndex: (value: number | null) => void;
  setHistoryDraft: (value: string) => void;
  setCtrlCArmed: (value: boolean) => void;
  setPickerQuery: (update: (current: string) => string) => void;
  setPickerIndex: (value: number) => void;
}

/** Composer/session actions, rebuilt per render over the current state (same
 *  semantics as the previous inline closures — bodies are verbatim). */
export function buildComposerActions(ctx: ComposerActionContext) {
  const {
    controller, snapshot, input, cursor, history, historyIndex, historyDraft,
    browsingHistory, ctrlCTimer, currentInteractionMode, app, onExit, onHistoryRecord,
    setInput, setCursor, setHistory, setHistoryIndex, setHistoryDraft, setCtrlCArmed,
    setPickerQuery, setPickerIndex,
  } = ctx;

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

  return {
    updateComposer, replaceComposer, disarmCtrlC, exitApp, submitCurrentInput,
    showPreviousHistory, showNextHistory, cycleInteractionMode, insertPastedText,
  };
}
