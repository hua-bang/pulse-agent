import { describe, expect, it } from 'vitest';
import type { ScheduledRunProgress } from '../../../../../shared/scheduled';
import { formatElapsed, runProgressLabel } from '../formatters';

/** Identity-ish translator: returns the key plus its interpolated params. */
const t = ((key: string, params?: Record<string, string | number>) =>
  params ? `${key}(${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(',')})` : key) as never;

const progress = (patch: Partial<ScheduledRunProgress>): ScheduledRunProgress => ({
  taskId: 'daily-brief',
  startedAt: 0,
  updatedAt: 0,
  phase: 'thinking',
  steps: [],
  toolCalls: 0,
  ...patch,
});

describe('formatElapsed', () => {
  it('keeps a narrow shape as a run grows', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(9_400)).toBe('9s');
    expect(formatElapsed(80_000)).toBe('1m 20s');
    expect(formatElapsed(3_600_000 + 4 * 60_000)).toBe('1h 04m');
  });

  it('never renders a negative duration from a clock skew', () => {
    expect(formatElapsed(-5_000)).toBe('0s');
  });
});

describe('runProgressLabel', () => {
  it('names the tool the run is currently calling', () => {
    expect(runProgressLabel(progress({
      phase: 'tool',
      toolCalls: 3,
      steps: [
        { index: 2, name: 'notion_search', status: 'done', startedAt: 0 },
        { index: 3, name: 'feishu_docs_read', status: 'running', startedAt: 0 },
      ],
    }), t)).toBe('scheduled.progressTool(step=3,tool=feishu_docs_read)');
  });

  it('reports the step count while the model reasons between tools', () => {
    expect(runProgressLabel(progress({ phase: 'thinking', toolCalls: 2 }), t))
      .toBe('scheduled.progressThinkingAfter(steps=2)');
    expect(runProgressLabel(progress({ phase: 'thinking' }), t)).toBe('scheduled.progressThinking');
    expect(runProgressLabel(progress({ phase: 'starting' }), t)).toBe('scheduled.progressStarting');
    expect(runProgressLabel(progress({ phase: 'writing', toolCalls: 2 }), t))
      .toBe('scheduled.progressWriting');
  });

  it('shows the stop in flight, whatever the run was doing', () => {
    expect(runProgressLabel(progress({ phase: 'tool', cancelRequested: true }), t))
      .toBe('scheduled.progressStopping');
  });

  // A run started by an older build, or a snapshot that has not landed yet,
  // must not render a blank status line.
  it('falls back to the generic working line with no progress', () => {
    expect(runProgressLabel(undefined, t)).toBe('scheduled.runningInline');
  });
});
