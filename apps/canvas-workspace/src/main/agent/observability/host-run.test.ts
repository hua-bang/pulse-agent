import { beforeEach, describe, expect, it, vi } from 'vitest';

const { publish } = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock('../../../plugins/main', () => ({ publishAgentTraceEvent: publish }));

import {
  beginCanvasHostRun,
  completeCanvasHostRun,
  markCanvasRuntimeCompleted,
  markCanvasRuntimeStarted,
} from './host-run';

describe('Canvas host observability lifecycle', () => {
  beforeEach(() => {
    publish.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
  });

  it('publishes a complete runtime-neutral run without a local debug trace', () => {
    const timing = beginCanvasHostRun('workspace', 'run-1', 'session-1');
    vi.setSystemTime(1_100);
    const runtimeStartedAt = markCanvasRuntimeStarted(timing, 1_050);
    vi.setSystemTime(1_300);
    const runtimeCompletedAt = markCanvasRuntimeCompleted(timing, runtimeStartedAt, 'pi');
    vi.setSystemTime(1_350);
    completeCanvasHostRun(timing, runtimeCompletedAt, 'success');

    expect(publish.mock.calls.map(([event]) => event.type)).toEqual([
      'run.started', 'phase.completed', 'phase.completed', 'phase.completed', 'run.completed',
    ]);
    expect(publish.mock.calls[0][0]).toMatchObject({ runId: 'run-1', sessionId: 'session-1' });
    expect(publish.mock.calls[2][0]).toMatchObject({ phase: 'runtime.execution', owner: 'pi' });
  });
});
