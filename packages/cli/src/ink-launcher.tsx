import React from 'react';

import { InkCliApp } from './ink-app.js';
import { createInkCoderController } from './ink-controller.js';
import { PromptHistoryStore } from './history-store.js';
import { EngineLogSink } from './log-sink.js';

export interface StartInkTuiOptions {
  continueLast?: boolean;
  verbose?: boolean;
}

export async function startInkTui(options: StartInkTuiOptions = {}): Promise<void> {
  // Install the console capture BEFORE the controller initializes the engine,
  // so the plugin-init log flood goes to the log file instead of the UI.
  const logSink = new EngineLogSink();
  logSink.install();

  const [{ render, Box, Text, Static, useApp, useInput, usePaste, useStdout }] = await Promise.all([
    import('ink'),
  ]);
  const historyStore = new PromptHistoryStore();
  const [controller, initialHistory] = await Promise.all([
    createInkCoderController({ continueLast: options.continueLast, verbose: options.verbose, logSink }),
    historyStore.load(),
  ]);
  const instance = render(
    <InkCliApp
      controller={controller}
      runtime={{ Box, Text, Static, useApp, useInput, usePaste, useStdout }}
      initialHistory={initialHistory}
      onHistoryRecord={entry => { void historyStore.append(entry); }}
    />,
    {
      // Ctrl+C is handled by the app itself (double-press to exit); Ink's
      // built-in handler would exit on the first press.
      exitOnCtrlC: false,
      // Console is owned by EngineLogSink — Ink's patchConsole would re-patch
      // console methods after us and pull engine logs back into the frame.
      patchConsole: false,
    },
  );

  await instance.waitUntilExit();
  await logSink.restore();
}
