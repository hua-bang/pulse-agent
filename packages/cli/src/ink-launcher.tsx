import React from 'react';

import { InkCliApp } from './ink-app.js';
import { createInkCoderController } from './ink-controller.js';
import { PromptHistoryStore } from './history-store.js';
import { EngineLogSink } from './log-sink.js';

export interface StartInkTuiOptions {
  continueLast?: boolean;
  verbose?: boolean;
  model?: string;
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
    createInkCoderController({ continueLast: options.continueLast, verbose: options.verbose, modelSpec: options.model, logSink }),
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

  // Ink puts stdin in raw mode, so a local Ctrl+C never becomes a signal — it
  // arrives as a raw byte and is handled by the app's double-press exit. These
  // handlers therefore cover only externally delivered signals (`kill`, a
  // supervisor or `docker stop` sending SIGTERM, CI cancelling the job), which
  // would otherwise terminate the process at Node's default disposition and
  // skip shutdown() — losing every turn since the last successful save.
  let signalled = false;
  const onSignal = () => {
    if (signalled) {
      return;
    }
    signalled = true;

    // shutdown() is idempotent, so racing an in-app exit is safe. Bound the wait:
    // a hung save (network home directory) must not make the CLI ignore SIGTERM
    // until the supervisor escalates to SIGKILL.
    const exit = async () => {
      instance.unmount();
      await logSink.restore().catch(() => {});
      process.exit(0);
    };
    const deadline = new Promise<void>(resolve => setTimeout(resolve, 3000).unref());
    void Promise.race([controller.shutdown().catch(() => {}), deadline]).then(exit, exit);
  };

  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  try {
    await instance.waitUntilExit();
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
  await logSink.restore();
}
