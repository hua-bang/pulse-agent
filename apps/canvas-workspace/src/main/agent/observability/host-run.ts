import { randomUUID } from 'crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

import { publishAgentTraceEvent } from '../../../plugins/main';
import type { AgentTraceScopeActivationStep } from '../../../shared/agent-observability';
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

const scopeActivationRun = new AsyncLocalStorage<CanvasAgentPerformanceTiming>();
// Async context outlives the collected work (timers, listeners created during
// init), so a closed collector falls through to normal publishing.
const scopeStepCollector = new AsyncLocalStorage<{ steps: ScopeActivationStepRecord[]; open: boolean }>();

export interface ScopeActivationStepRecord {
  step: AgentTraceScopeActivationStep;
  startedAt: number;
  finishedAt: number;
  detail?: string;
}

/**
 * Attribute nested scope-activation steps to this run. Steps reached from
 * deep activation code (agent init, storage guards) find the run through
 * async context instead of a threaded parameter.
 */
export const traceCanvasScopeActivation = <T>(
  timing: CanvasAgentPerformanceTiming | undefined,
  operation: () => Promise<T>,
): Promise<T> => (timing ? scopeActivationRun.run(timing, operation) : operation());

const publishScopeStep = (timing: CanvasAgentPerformanceTiming, record: ScopeActivationStepRecord): void => {
  publishAgentTraceEvent({
    type: 'phase.completed', runId: timing.runId, timestamp: record.finishedAt,
    phase: record.step, owner: 'canvas-host', startedAt: record.startedAt, finishedAt: record.finishedAt,
    parentPhase: 'canvas.scope-activation',
    ...(record.detail ? { detail: record.detail } : {}),
  });
};

/** Record a step with known bounds; collected work is replayed later, otherwise published now. */
export const recordScopeActivationStep = (record: ScopeActivationStepRecord): void => {
  const collector = scopeStepCollector.getStore();
  if (collector?.open) {
    collector.steps.push(record);
    return;
  }
  const timing = scopeActivationRun.getStore();
  if (timing) publishScopeStep(timing, record);
};

/** Time one step inside scope activation; a no-op outside a traced or collected activation. */
export const traceScopeActivationStep = async <T>(
  step: AgentTraceScopeActivationStep,
  operation: () => Promise<T>,
): Promise<T> => {
  if (!scopeStepCollector.getStore()?.open && !scopeActivationRun.getStore()) return operation();
  const startedAt = Date.now();
  try {
    return await operation();
  } finally {
    recordScopeActivationStep({ step, startedAt, finishedAt: Date.now() });
  }
};

/**
 * Collect steps of shared work (agent init) instead of publishing them, so
 * every run that awaited it — including one that joined a warm-up without a
 * trace of its own — can replay the same breakdown.
 */
export const collectScopeActivationSteps = async (
  operation: () => Promise<void>,
): Promise<ScopeActivationStepRecord[]> => {
  const collector = { steps: [] as ScopeActivationStepRecord[], open: true };
  try {
    await scopeStepCollector.run(collector, operation);
  } finally {
    collector.open = false;
  }
  return collector.steps;
};

export const replayScopeActivationSteps = (steps: readonly ScopeActivationStepRecord[]): void => {
  for (const step of steps) recordScopeActivationStep(step);
};

export const markConversationLaneEntered = (timing?: CanvasAgentPerformanceTiming): void => {
  if (!timing) return;
  const timestamp = Date.now();
  publishAgentTraceEvent({
    type: 'phase.completed', runId: timing.runId, timestamp,
    phase: 'canvas.queue', owner: 'canvas-host',
    startedAt: timing.scopeReadyAt, finishedAt: timestamp,
  });
  timing.scopeReadyAt = timestamp;
};

export const observeConversationPersistence = async (
  timing: CanvasAgentPerformanceTiming | undefined,
  persist: () => Promise<void>,
): Promise<void> => {
  const startedAt = Date.now();
  try {
    await persist();
  } finally {
    if (timing) publishAgentTraceEvent({
      type: 'phase.completed', runId: timing.runId, timestamp: Date.now(),
      phase: 'canvas.persistence', owner: 'canvas-host', startedAt, finishedAt: Date.now(),
    });
  }
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
  if (!timing.deferCompletion) {
    publishAgentTraceEvent({ type: 'run.completed', runId: timing.runId, timestamp, status });
  }
};

export const failCanvasHostRun = (
  timing: CanvasAgentPerformanceTiming,
  error: unknown,
): void => publishAgentTraceEvent({
  type: 'run.completed', runId: timing.runId, timestamp: Date.now(),
  status: 'error', error: String(error),
});
