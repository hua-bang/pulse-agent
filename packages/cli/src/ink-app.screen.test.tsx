import { EventEmitter } from 'node:events';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { InkCliApp, type InkCliSnapshot } from './ink-app.js';
import { InkUiBridge } from './ink-ui-bridge.js';

/**
 * Screen-level guards.
 *
 * `ink-app.render.test.tsx` measures the frame's height; this file measures
 * what the escape sequences actually do to a terminal. Two things only show up
 * here: whether the composer stays put while a run streams (a live region that
 * shrinks without matching `<Static>` output walks it up the screen, leaving
 * dead space below), and whether the launcher's incremental writer paints the
 * same picture as Ink's default full-repaint writer.
 */

const ROWS = 24;
const COLUMNS = 80;

/** Minimal VT emulator for the escape subset ink and log-update emit. */
class TerminalScreen extends EventEmitter {
  isTTY = true;
  rows = ROWS;
  columns = COLUMNS;
  private grid: string[] = [''];
  private row = 0;
  private col = 0;

  getWindowSize(): [number, number] {
    return [this.columns, this.rows];
  }

  write(data: string): boolean {
    let index = 0;
    while (index < data.length) {
      const char = data[index];

      if (char === '\x1b') {
        const match = /^\x1b\[([0-9;?]*)([A-Za-z])/.exec(data.slice(index));
        if (!match) {
          index += 1;
          continue;
        }
        this.applyEscape(match[1], match[2]);
        index += match[0].length;
        continue;
      }

      if (char === '\n') {
        this.row += 1;
        this.col = 0;
        this.lineAt(this.row);
      } else if (char === '\r') {
        this.col = 0;
      } else {
        const line = this.lineAt(this.row).padEnd(this.col, ' ');
        this.grid[this.row] = line.slice(0, this.col) + char + line.slice(this.col + 1);
        this.col += 1;
      }
      index += 1;
    }
    return true;
  }

  private applyEscape(params: string, command: string): void {
    const count = Number.parseInt(params || '1', 10);
    const amount = Number.isNaN(count) ? 1 : count;
    switch (command) {
      case 'A': this.row = Math.max(0, this.row - amount); break;
      case 'B': this.row += amount; break;
      case 'G': this.col = Math.max(0, amount - 1); break;
      case 'E': this.row += amount; this.col = 0; break;
      case 'K': this.grid[this.row] = params === '2' ? '' : this.lineAt(this.row).slice(0, this.col); break;
      case 'J': if (params === '2') { this.grid = ['']; this.row = 0; this.col = 0; } break;
      case 'H': this.row = 0; this.col = 0; break;
      default: break;
    }
  }

  private lineAt(row: number): string {
    while (this.grid.length <= row) {
      this.grid.push('');
    }
    return this.grid[row];
  }

  /** Absolute row of the composer's top border, or -1 when it is not painted. */
  composerRow(): number {
    return this.grid.findIndex(line => line.includes('╭'));
  }

  /** What the user can see: the last `rows` lines of everything written. */
  visible(): string[] {
    return this.grid.slice(Math.max(0, this.grid.length - this.rows)).map(line => line.trimEnd());
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

/** A run as the bridge actually drives it, including the `<Static>` writes. */
const driveRun = (bridge: InkUiBridge, step: () => Promise<void>) => async (): Promise<string[]> => {
  const labels: string[] = [];
  const at = async (label: string) => {
    await step();
    labels.push(label);
  };

  bridge.user('please refactor the parser');
  bridge.startProcessing('Running agent');
  await at('run start');

  for (let index = 0; index < 14; index += 1) {
    bridge.text(`Reading the parser module first, note ${index}.\n`);
  }
  await at('narration streamed');

  bridge.toolCall('read_file', { filePath: 'src/parser.ts' }, 'call-1');
  await at('tool call finalizes the narration');

  bridge.toolResult('read_file', 'parsed\n'.repeat(30), 'call-1');
  await at('tool result');

  for (let index = 0; index < 9; index += 1) {
    bridge.text(`Second narration line ${index}.\n`);
  }
  await at('more narration');

  bridge.toolCall('bash', { command: 'pnpm test' }, 'call-2');
  await at('second tool call');

  bridge.toolResult('bash', 'ok', 'call-2');
  await at('second tool result');

  bridge.text('All done — here is the summary of what changed.\n');
  bridge.runSummary({ messages: 6, estimatedTokens: 1200, mode: 'edit', elapsedMs: 4200, toolCalls: 2 });
  await at('run end');

  return labels;
};

const renderRun = async (options: { incrementalRendering: boolean }) => {
  const ink = await import('ink');
  const screen = new TerminalScreen();
  let current: InkCliSnapshot;
  let publish: ((snapshot: InkCliSnapshot) => void) | undefined;
  const bridge = new InkUiBridge({
    onChange: snapshot => {
      current = snapshot;
      publish?.(snapshot);
    },
    textThrottleMs: 0,
  });
  current = bridge.getSnapshot();

  const instance = ink.render(
    <InkCliApp
      controller={{
        getSnapshot: () => current,
        submitInput: () => {},
        requestStop: () => {},
        shutdown: () => {},
        subscribe: listener => {
          publish = listener;
          return () => {};
        },
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
    {
      stdout: screen as never,
      stdin: new MockStdin() as never,
      exitOnCtrlC: false,
      patchConsole: false,
      incrementalRendering: options.incrementalRendering,
    },
  );

  const composerRows: number[] = [];
  const labels = await driveRun(bridge, async () => {
    await new Promise(resolve => setTimeout(resolve, 45));
    composerRows.push(screen.composerRow());
  })();

  instance.unmount();
  return { labels, composerRows, visible: screen.visible() };
};

/** Elapsed seconds and the spinner frame move on wall-clock, not on state. */
const stableScreen = (lines: string[]): string[] => lines.map(line => line
  .replace(/\d+m\d+s|\d+(\.\d+)?s\b/g, '<elapsed>')
  .replace(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/g, '<spinner>'));

describe('InkCliApp on a terminal', () => {
  it('keeps the composer anchored through a whole run', async () => {
    const { labels, composerRows } = await renderRun({ incrementalRendering: true });

    expect(composerRows.every(row => row >= 0)).toBe(true);

    // The composer may only move DOWN (new output pushes it) — an upward move
    // means the live region shrank without matching <Static> output and left
    // dead rows below it. One row of slack covers a live tool line retiring
    // into a one-row trace.
    const steps = composerRows.slice(1).map((row, index) => row - composerRows[index]);
    const jumps = steps
      .map((delta, index) => ({ delta, label: labels[index + 1] }))
      .filter(step => step.delta < -1);

    expect(jumps).toEqual([]);
  });

  it('paints the same screen incrementally as it does with a full repaint', async () => {
    // The launcher enables incrementalRendering to stop the whole live block
    // being erased and repainted 30 times a second. It must land the user on
    // exactly the same screen as Ink's default writer.
    const incremental = await renderRun({ incrementalRendering: true });
    const full = await renderRun({ incrementalRendering: false });

    // Not a comparison of two blank screens: there is a real UI on both.
    expect(incremental.visible.some(line => line.includes('╭'))).toBe(true);
    expect(incremental.visible.filter(Boolean).length).toBeGreaterThan(5);

    expect(stableScreen(incremental.visible)).toEqual(stableScreen(full.visible));
  });
});
