import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
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

// Ink reads input via 'readable' + stdin.read(), so anything that has to reach
// the composer (a draft is app state, not snapshot state) must be pushed
// through a real paused-mode Readable — same shape as ink-app.screen.test.tsx.
class MockStdin extends Readable {
  isTTY = true;
  _read(): void {}
  setRawMode(): this {
    return this;
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

/**
 * Types `draft` into the composer as one terminal chunk (what a paste is) and
 * measures the frame that lands afterwards. The draft cannot come from a
 * snapshot — it is the app's own state, so it has to arrive as real stdin bytes.
 */
const renderDraft = async (
  draft: string,
  snapshot: InkCliSnapshot = { ...baseSnapshot, isProcessing: false, status: 'Ready', phase: 'Idle' },
  viewport: Viewport = DEFAULT_VIEWPORT,
) => {
  const ink = await import('ink');
  const stdout = new MockStdout(viewport.columns, viewport.rows);
  const stdin = new MockStdin();
  const instance = ink.render(
    <InkCliApp
      controller={{
        getSnapshot: () => snapshot,
        submitInput: () => {},
        requestStop: () => {},
        shutdown: () => {},
        subscribe: () => () => {},
      }}
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
    { stdout: stdout as never, stdin: stdin as never, exitOnCtrlC: false, patchConsole: false },
  );

  await new Promise(resolve => setTimeout(resolve, 60));
  if (draft) {
    stdout.frames.length = 0;
    stdin.push(Buffer.from(draft));
    await new Promise(resolve => setTimeout(resolve, 80));
  }

  const frames = stdout.frames.splice(0);
  instance.unmount();
  return { height: frameHeight(frames), painted: frames.join('') };
};

/** What a picker actually paints on a given viewport. */
const renderPickerScreen = async (viewport: Viewport) => {
  const { painted } = await renderDraft('', {
    ...baseSnapshot,
    isProcessing: false,
    picker: {
      title: 'Resume a session',
      items: Array.from({ length: 30 }, (_, index) => ({
        id: `session-${index}`,
        label: `Session ${index}`,
        hint: '12 msgs · 3h ago',
      })),
    },
  }, viewport);
  return painted;
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

  it('keeps a pasted wall of text in the draft under the viewport', async () => {
    // One logical line, ~27 physical rows at 80 columns: a draft window that
    // caps LOGICAL lines lets this through whole, and the composer alone is
    // then taller than the terminal — every keystroke repaints the screen.
    const pasted = `https://example.com/${'a1b2c3d4'.repeat(247)}abcd`;
    expect(pasted).toHaveLength(2_000);

    const { height, painted } = await renderDraft(pasted);

    expect(height).toBeLessThan(DEFAULT_VIEWPORT.rows);
    // …and it still shows the draft: the cursor (end of the paste) is painted,
    // above it the head says the rest scrolled off. A window that collapsed to
    // nothing would satisfy the height bound while showing no draft at all.
    expect(painted).toContain('█');
    expect(painted).toMatch(/… \d+ earlier draft lines/);
  });

  it('holds the draft bound on a short terminal and while an answer streams', async () => {
    const pasted = 'x'.repeat(3_000);

    expect((await renderDraft(pasted, undefined, { rows: 12, columns: 80 })).height).toBeLessThan(12);
    expect((await renderDraft(pasted, undefined, { rows: 24, columns: 40 })).height).toBeLessThan(24);
    // Streaming text and a wall-of-text draft compete for the same screen.
    const streaming = { ...baseSnapshot, liveText: streamedAnswer(200) };
    expect((await renderDraft(pasted, streaming)).height).toBeLessThan(DEFAULT_VIEWPORT.rows);
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

  it('fits the picker into a terminal too short for its old two-item floor', async () => {
    // The picker's own chrome (border, title, the "… N more" row, the hint)
    // plus a floor of two items measured 9 rows on a 9-row screen, and a
    // picker that overflows puts Ink into clear-and-replay just like a
    // streamed answer does. The floor is gone; items get whatever is left.
    const snapshot: InkCliSnapshot = {
      ...baseSnapshot,
      isProcessing: false,
      picker: {
        title: 'Resume a session',
        items: Array.from({ length: 30 }, (_, index) => ({
          id: `session-${index}`,
          label: `Session ${index} · a fairly long session title that fills the row`,
          hint: '12 msgs · 3h ago',
        })),
      },
    };

    for (const rows of [9, 10, 11]) {
      const [height] = await renderSequence([snapshot], { rows, columns: 80 });
      expect(height, `viewport ${rows} rows`).toBeLessThan(rows);
    }
  });

  it('still shows a pickable entry on a short terminal', async () => {
    // Bounded is not enough: a picker with no visible entry cannot be used.
    // The hint line is what gets dropped first when the screen is that tight.
    const stdout = await renderPickerScreen({ rows: 10, columns: 80 });

    expect(stdout).toContain('Session 0');
    expect(stdout).toContain('→ ');
  });

  it('never orphan-wraps a tool trace summary onto its own row', async () => {
    // title/summary are separate fields (ink-ui-bridge.ts) precisely so the
    // LABEL truncates against the terminal width while the summary always
    // stays on the same row — a long label used to overflow the concatenated
    // "label · summary" string and wrap "· 252 lines" alone onto the next row.
    const { painted } = await renderDraft('', {
      ...baseSnapshot,
      isProcessing: false,
      status: 'Ready',
      phase: 'Idle',
      events: [{
        id: 'e1',
        kind: 'tool',
        title: 'edit packages/cli/src/a-fairly-long-file-name-for-this-test.ts',
        summary: '252 lines',
        status: 'success',
        text: '',
      }],
    }, { rows: 24, columns: 40 });

    const clean = painted.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
    const lines = clean.split('\n');
    const summaryLine = lines.find(line => line.includes('252 lines'));
    expect(summaryLine).toBeDefined();
    // The row carrying the summary must also carry (a truncated) label —
    // an orphaned wrap would put "· 252 lines" alone at the start of a row.
    expect(summaryLine).toMatch(/edit .*252 lines/);
  });
});
