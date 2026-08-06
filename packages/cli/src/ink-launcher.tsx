import React from 'react';

import { InkCliApp } from './ink-app.js';
import { createInkCoderController } from './ink-controller.js';
import { PromptHistoryStore } from './history-store.js';

export interface StartInkTuiOptions {
  continueLast?: boolean;
}

export async function startInkTui(options: StartInkTuiOptions = {}): Promise<void> {
  const [{ render, Box, Text, Static, useApp, useInput, usePaste, useStdout }] = await Promise.all([
    import('ink'),
  ]);
  const historyStore = new PromptHistoryStore();
  const [controller, initialHistory] = await Promise.all([
    createInkCoderController({ continueLast: options.continueLast }),
    historyStore.load(),
  ]);
  const instance = render(
    <InkCliApp
      controller={controller}
      runtime={{ Box, Text, Static, useApp, useInput, usePaste, useStdout }}
      initialHistory={initialHistory}
      onHistoryRecord={entry => { void historyStore.append(entry); }}
    />,
    // Ctrl+C is handled by the app itself (double-press to exit); Ink's
    // built-in handler would exit on the first press.
    { exitOnCtrlC: false },
  );

  await instance.waitUntilExit();
}
