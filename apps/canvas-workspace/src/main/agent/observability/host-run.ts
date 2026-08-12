import { randomUUID } from 'crypto';

import { publishAgentTraceEvent } from '../../../plugins/main';
import type { CanvasAgentPerformanceTiming } from '../debug-trace';

export const beginCanvasHostRun = (
  scope: 'global' | 'workspace' | 'scheduled',
  runId: string = randomUUID(),
  sessionId?: string,
): CanvasAgentPerformanceTiming => {
  const requestStartedAt = Date.now();
  publishAgentTraceEvent({
    type: 'run.started', runId, timestamp: requestStartedAt, sessionId, scope, host: 'canvas',
  });
  return {
    runId, requestStartedAt, laneEnteredAt: requestStartedAt,
    scopeReadyAt: requestStartedAt, contextReadyAt: requestStartedAt,
  };
};

export const markCanvasHostLaneEntered = (timing: CanvasAgentPerformanceTiming): void => {
  timing.laneEnteredAt = Date.now();
  publishAgentTraceEvent({
    type: 'phase.completed', runId: timing.runId, timestamp: timing.laneEnteredAt,
    phase: 'canvas.queue', owner: 'canvas-host',
    startedAt: timing.requestStartedAt, finishedAt: timing.laneEnteredAt,
  });
};

export const markCanvasHostScopeReady = (timing: CanvasAgentPerformanceTiming): void => {
  timing.scopeReadyAt = Date.now();
  publishAgentTraceEvent({
    type: 'phase.completed', runId: timing.runId, timestamp: timing.scopeReadyAt,
    phase: 'canvas.scope-activation', owner: 'canvas-host',
    startedAt: timing.laneEnteredAt, finishedAt: timing.scopeReadyAt,
  });
};

export const markCanvasHostContextReady = (timing?: CanvasAgentPerformanceTiming): void => {
  if (!timing) return;
  timing.contextReadyAt = Date.now();
  publishAgentTraceEvent({
    type: 'phase.completed', runId: timing.runId, timestamp: timing.contextReadyAt,
    phase: 'canvas.context-preparation', owner: 'canvas-host',
    startedAt: timing.scopeReadyAt, finishedAt: timing.contextReadyAt,
  });
};

export const markCanvasRuntimeStarted = (
  timing: CanvasAgentPerformanceTiming | undefined,
  startedAt: number,
): number => {
  const timestamp = Date.now();
  if (timing) publishAgentTraceEvent({
    type: 'phase.completed', runId: timing.runId, timestamp,
    phase: 'canvas.runtime-dispatch', owner: 'canvas-host', startedAt, finishedAt: timestamp,
  });
  return timestamp;
};

export const markCanvasRuntimeCompleted = (
  timing: CanvasAgentPerformanceTiming | undefined,
  startedAt: number,
  owner: 'engine' | 'pi',
): number => {
  const timestamp = Date.now();
  if (timing) publishAgentTraceEvent({
    type: 'phase.completed', runId: timing.runId, timestamp,
    phase: 'runtime.execution', owner, startedAt, finishedAt: timestamp,
  });
  return timestamp;
};

export const completeCanvasHostRun = (
  timing: CanvasAgentPerformanceTiming | undefined,
  responseStartedAt: number,
  status: 'success' | 'stopped',
): void => {
  if (!timing) return;
  const timestamp = Date.now();
  publishAgentTraceEvent({
    type: 'phase.completed', runId: timing.runId, timestamp,
    phase: 'canvas.response-processing', owner: 'canvas-host',
    startedAt: responseStartedAt, finishedAt: timestamp,
  });
  publishAgentTraceEvent({ type: 'run.completed', runId: timing.runId, timestamp, status });
};

export const failCanvasHostRun = (
  timing: CanvasAgentPerformanceTiming,
  error: unknown,
): void => publishAgentTraceEvent({
  type: 'run.completed', runId: timing.runId, timestamp: Date.now(),
  status: 'error', error: String(error),
});
