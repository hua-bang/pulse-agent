import { beforeEach, describe, expect, it, vi } from 'vitest';

const { publish } = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock('../../../plugins/main', () => ({ publishAgentTraceEvent: publish }));

import {
  beginCanvasHostRun,
  completeCanvasHostRun,
  markCanvasRuntimeCompleted,
  markCanvasRuntimeStarted,
  traceCanvasScopeActivation,
  traceScopeActivationStep,
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

  it('attributes nested scope-activation steps to the traced run only', async () => {
    const timing = beginCanvasHostRun('workspace', 'run-2');
    publish.mockReset();

    await traceScopeActivationStep('canvas.scope.engine-init', async () => undefined);
    expect(publish).not.toHaveBeenCalled();

    await traceCanvasScopeActivation(timing, async () => {
      await Promise.resolve();
      await traceScopeActivationStep('canvas.scope.engine-init', async () => {
        vi.setSystemTime(1_400);
      });
    });

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][0]).toEqual({
      type: 'phase.completed', runId: 'run-2', timestamp: 1_400,
      phase: 'canvas.scope.engine-init', owner: 'canvas-host',
      startedAt: 1_000, finishedAt: 1_400, parentPhase: 'canvas.scope-activation',
    });
  });

  it('still records a step whose operation fails', async () => {
    const timing = beginCanvasHostRun('global', 'run-3');
    publish.mockReset();
    await expect(traceCanvasScopeActivation(timing, () => (
      traceScopeActivationStep('canvas.scope.agent-init', async () => { throw new Error('init failed'); })
    ))).rejects.toThrow('init failed');
    expect(publish.mock.calls[0][0]).toMatchObject({ phase: 'canvas.scope.agent-init', runId: 'run-3' });
  });
});
