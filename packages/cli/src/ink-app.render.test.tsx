import { EventEmitter } from 'node:events';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { InkCliApp, type InkCliController, type InkCliSnapshot } from './ink-app.js';

/**
 * Frame-height regression guard.
 *
 * Ink re-prints the whole screen (`clearTerminal` + a replay of the entire
 * static transcript) for as long as the live frame is taller than the
 * viewport — that full-screen wipe at streaming frame rate is the flicker
 * these tests exist to prevent. So the assertion is on the physical height of
 * what Ink actually writes, not on any single region's own bound.
 */

interface Viewport {
  rows: number;
  columns: number;
}

const DEFAULT_VIEWPORT: Viewport = { rows: 24, columns: 80 };

class MockStdout extends EventEmitter {
  isTTY = true;
  readonly frames: string[] = [];

  constructor(readonly columns: number, readonly rows: number) {
    super();
  }

  write(data: string): boolean {
    this.frames.push(data);
    return true;
  }

  getWindowSize(): [number, number] {
    return [this.columns, this.rows];
  }
}

class MockStdin extends EventEmitter {
  isTTY = true;
  setRawMode(): void {}
  resume(): void {}
  pause(): void {}
  setEncoding(): void {}
  read(): null {
    return null;
  }
  unref(): void {}
  ref(): void {}
}

const baseSnapshot: InkCliSnapshot = {
  sessionId: 'session-1',
  taskListId: null,
  mode: 'edit',
  messages: 4,
  estimatedTokens: 1200,
  usageInputTokens: 1200,
  usageOutputTokens: 400,
  contextWindowTokens: 64000,
  modelLabel: 'deepseek_v3',
  queuedInputs: 0,
  isProcessing: true,
  status: 'Running agent',
  phase: 'Using tool',
  activeTool: 'bash',
  toolCalls: 2,
  completedTools: 1,
  lastStep: null,
  runStartedAt: 1_000,
  picker: null,
  skills: [],
  fileIndex: [],
  events: [],
  liveText: '',
  liveTools: [],
};

const streamedAnswer = (lines: number): string =>
  Array.from({ length: lines }, (_, index) => `streamed line ${index}`).join('\n');

/**
 * Physical rows of the tallest frame Ink wrote, ANSI escapes excluded. Ink
 * brackets each frame with cursor/sync writes, so the content frame is picked
 * by height rather than by position.
 */
const frameHeight = (frames: string[]): number => Math.max(
  0,
  ...frames.map(frame => frame
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\n$/, '')
    .split('\n')
    .length),
);

const renderFrame = async (snapshot: InkCliSnapshot, viewport: Viewport = DEFAULT_VIEWPORT) => {
  const [height] = await renderSequence([snapshot], viewport);
  return height;
};

/**
 * Renders each snapshot in turn through one mounted app and returns the frame
 * height after each — the app's own state (the live-region reservation) is
 * carried across the sequence, which a fresh mount per snapshot would lose.
 */
const renderSequence = async (snapshots: InkCliSnapshot[], viewport: Viewport = DEFAULT_VIEWPORT) => {
  const ink = await import('ink');
  const stdout = new MockStdout(viewport.columns, viewport.rows);
  let current = snapshots[0];
  let publish: ((snapshot: InkCliSnapshot) => void) | undefined;
  const controller: InkCliController = {
    getSnapshot: () => current,
    submitInput: () => {},
    requestStop: () => {},
    shutdown: () => {},
    subscribe: listener => {
      publish = listener;
      return () => {};
    },
  };

  const instance = ink.render(
    <InkCliApp
      controller={controller}
      runtime={{
        Box: ink.Box,
        Text: ink.Text,
        Static: ink.Static,
        useApp: ink.useApp,
        useInput: ink.useInput,
        usePaste: ink.usePaste,
        useStdout: ink.useStdout,
      }}
    />,
    {
      stdout: stdout as never,
      stdin: new MockStdin() as never,
      exitOnCtrlC: false,
      patchConsole: false,
      // Deliberately NOT the launcher's incrementalRendering: that writer emits
      // per-line diffs, and these tests measure block geometry — a property of
      // the React tree, not of which writer ink uses to paint it.
    },
  );

  const heights: number[] = [];
  for (const snapshot of snapshots) {
    current = snapshot;
    publish?.(snapshot);
    // Let React commit and Ink flush the frame.
    await new Promise(resolve => setTimeout(resolve, 60));
    heights.push(frameHeight(stdout.frames.splice(0)));
  }

  instance.unmount();
  return heights;
};

describe('InkCliApp frame height', () => {
  it('keeps a long streamed answer under the viewport', async () => {
    const height = await renderFrame({ ...baseSnapshot, liveText: streamedAnswer(200) });

    expect(height).toBeLessThan(DEFAULT_VIEWPORT.rows);
    // …and still uses the room it has: a window that collapsed to nothing would
    // pass the bound above while showing no streaming output at all.
    expect(height).toBeGreaterThan(10);
  });

  it('charges over-wide streamed lines their wrapped height', async () => {
    // Every line reflows onto several rows: a budget counting one row per line
    // would overflow here.
    const liveText = Array.from({ length: 60 }, (_, index) => `${index} ${'wide '.repeat(50)}`).join('\n');

    expect(await renderFrame({ ...baseSnapshot, liveText })).toBeLessThan(DEFAULT_VIEWPORT.rows);
  });

  it('gives running tools and a multi-line draft their rows first', async () => {
    const snapshot: InkCliSnapshot = {
      ...baseSnapshot,
      liveText: streamedAnswer(200),
      liveTools: Array.from({ length: 8 }, (_, index) => ({
        id: `tool-${index}`,
        name: 'bash',
        label: `bash: $ pnpm --filter pulse-coder-cli test ${index}`,
      })),
    };

    expect(await renderFrame(snapshot)).toBeLessThan(DEFAULT_VIEWPORT.rows);
  });

  it('holds the bound on narrow and short terminals', async () => {
    const snapshot = { ...baseSnapshot, liveText: streamedAnswer(200) };

    // Narrow: the key hint and status line wrap onto extra rows.
    expect(await renderFrame(snapshot, { rows: 24, columns: 40 })).toBeLessThan(24);
    // Short: the fixed regions alone nearly fill the screen.
    expect(await renderFrame(snapshot, { rows: 12, columns: 80 })).toBeLessThan(12);
    expect(await renderFrame(snapshot, { rows: 8, columns: 60 })).toBeLessThan(8);
  });

  it('holds the bound while the picker is open', async () => {
    const snapshot: InkCliSnapshot = {
      ...baseSnapshot,
      liveText: streamedAnswer(200),
      picker: {
        title: 'Resume a session',
        items: Array.from({ length: 30 }, (_, index) => ({
          id: `session-${index}`,
          label: `Session ${index} · a fairly long session title that fills the row`,
          hint: '12 msgs · 3h ago',
          preview: 'last message preview text that also runs long',
        })),
      },
    };

    expect(await renderFrame(snapshot)).toBeLessThan(DEFAULT_VIEWPORT.rows);
  });
});
