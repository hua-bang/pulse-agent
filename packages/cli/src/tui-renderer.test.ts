import { afterEach, describe, expect, it, vi } from 'vitest';

import { TuiRenderer } from './tui-renderer.js';

class MemoryOutput {
  isTTY = true;
  columns = 80;
  chunks: string[] = [];
  clearCount = 0;
  cursorCount = 0;

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }

  clearLine(): boolean {
    this.clearCount += 1;
    return true;
  }

  cursorTo(): boolean {
    this.cursorCount += 1;
    return true;
  }

  text(): string {
    return this.chunks.join('');
  }
}

describe('TuiRenderer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders boxed welcome and help in interactive terminals', () => {
    const output = new MemoryOutput();
    const renderer = new TuiRenderer({ output, enabled: true });

    renderer.showWelcome();
    renderer.showHelp([{ command: '/help', description: 'Show help' }], ['Ctrl+C - Exit']);

    const text = output.text();
    expect(text).toContain('Pulse Coder CLI');
    expect(text).toContain('╭─');
    expect(text).toContain('Commands');
    expect(text).toContain('/help');
    expect(text).toContain('Ctrl+C - Exit');
  });

  it('uses plain prompts and plain text when TUI is disabled', () => {
    const output = new MemoryOutput();
    output.isTTY = false;
    const renderer = new TuiRenderer({ output, enabled: false });

    expect(renderer.prompt()).toBe('> ');
    expect(renderer.prompt('teams')).toBe('teams> ');

    renderer.showWelcome();
    renderer.showHelp([{ command: '/status', description: 'Show status' }]);

    const text = output.text();
    expect(text).toContain('🚀 Pulse Coder CLI is running');
    expect(text).toContain('/status - Show status');
  });

  it('clears spinner status before streaming text', () => {
    vi.useFakeTimers();
    const output = new MemoryOutput();
    const renderer = new TuiRenderer({ output, enabled: true, now: () => 1_000 });

    renderer.startProcessing('Running agent');
    renderer.text('hello');

    expect(output.text()).toContain('Running agent');
    expect(output.text()).toContain('hello');
    expect(output.clearCount).toBeGreaterThan(0);
    expect(output.cursorCount).toBeGreaterThan(0);
  });

  it('renders tool calls and results with safe, truncated input', () => {
    const output = new MemoryOutput();
    const renderer = new TuiRenderer({ output, enabled: true });

    renderer.toolCall('bash', { command: 'x'.repeat(240) });
    renderer.toolResult('bash');

    const text = output.text();
    expect(text).toContain('bash');
    expect(text).toContain('… truncated');
    expect(text).toContain('✅');
  });

  it('supports runtime TUI toggling when terminal capabilities allow it', () => {
    const output = new MemoryOutput();
    const renderer = new TuiRenderer({ output, enabled: false });

    expect(renderer.isEnabled()).toBe(false);
    expect(renderer.setEnabled(true)).toBe(true);
    expect(renderer.isEnabled()).toBe(true);
    expect(renderer.prompt()).toContain('›');

    renderer.setEnabled(false);
    expect(renderer.prompt()).toBe('> ');
  });

  it('refuses to enable TUI when terminal capabilities are unavailable', () => {
    const output = new MemoryOutput();
    output.isTTY = false;
    const renderer = new TuiRenderer({ output, enabled: false });

    expect(renderer.isAvailable()).toBe(false);
    expect(renderer.setEnabled(true)).toBe(false);
    expect(renderer.isEnabled()).toBe(false);
  });

  it('renders session snapshots and run summaries', () => {
    const output = new MemoryOutput();
    const renderer = new TuiRenderer({ output, enabled: true });

    renderer.session({
      sessionId: 'abc123',
      taskListId: 'tasks-a',
      messages: 4,
      estimatedTokens: 256,
      mode: 'planning',
    });
    renderer.runSummary({
      elapsedMs: 1_250,
      toolCalls: 2,
      messages: 6,
      estimatedTokens: 512,
      mode: 'executing',
    });

    const text = output.text();
    expect(text).toContain('session abc123');
    expect(text).toContain('tasks tasks-a');
    expect(text).toContain('Run Summary');
    expect(text).toContain('Elapsed: 1.3s');
    expect(text).toContain('Tools: 2');
  });
});
