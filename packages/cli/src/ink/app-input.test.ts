import { describe, expect, it, vi } from 'vitest';

import { buildKeyHandler, type ComposerKeyContext } from './app-input.js';

function createContext(input = ''): ComposerKeyContext {
  const noop = vi.fn();
  return {
    controller: {
      submitInput: vi.fn(),
    },
    snapshot: {
      isProcessing: false,
      picker: null,
    },
    input,
    cursor: input.length,
    historyIndex: null,
    browsingHistory: { current: false },
    ctrlCArmed: false,
    ctrlCTimer: { current: null },
    pickerItems: [],
    clampedPickerIndex: 0,
    selectedFile: undefined,
    selectedSuggestion: undefined,
    fileSuggestions: [],
    slashSuggestions: [],
    setInput: noop,
    setCursor: noop,
    setHistoryIndex: noop,
    setHistoryDraft: noop,
    setCtrlCArmed: noop,
    setPickerIndex: noop,
    setPickerQuery: noop,
    setSelectedFileIndex: noop,
    setSelectedSuggestionIndex: noop,
    updateComposer: noop,
    disarmCtrlC: noop,
    exitApp: noop,
    submitCurrentInput: noop,
    showPreviousHistory: noop,
    showNextHistory: noop,
    cycleInteractionMode: noop,
    insertPastedText: noop,
  } as unknown as ComposerKeyContext;
}

describe('buildKeyHandler clipboard image shortcut', () => {
  it('routes the legacy Ctrl+V key shape to /paste-image', () => {
    const context = createContext('describe this');
    const handler = buildKeyHandler(context);

    handler('v', { ctrl: true, shift: false });

    expect(context.controller.submitInput).toHaveBeenCalledWith('/paste-image describe this');
    expect(context.setInput).toHaveBeenCalledWith('');
    expect(context.setCursor).toHaveBeenCalledWith(0);
  });
});
