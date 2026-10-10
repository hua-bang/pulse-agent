import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createCanvasAgentDebugTrace,
  attachTraceRuntime,
  finalizeCanvasAgentDebugTrace,
  isCanvasAgentDebugTraceEnabled,
  markTraceModelStarted,
  markTraceRuntimeCompleted,
  recordTraceStreamEvent,
} from './debug-trace';

const createTrace = () => createCanvasAgentDebugTrace({
  sessionId: 'session-1',
  userPrompt: 'hello',
  attachmentCount: 0,
  mentionedCanvases: [],
  summary: null,
  systemPrompt: 'system',
  performance: {
    runId: 'run-1',
    requestStartedAt: 1_000,
    laneEnteredAt: 1_025,
    scopeReadyAt: 1_075,
    contextReadyAt: 1_175,
  },
});

describe('canvas agent debug trace performance', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('requires development mode and the observability master switch', () => {
    vi.stubEnv('CANVAS_AGENT_DEBUG_TRACE', '1');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PULSE_CANVAS_AGENT_OBSERVABILITY', '1');
    expect(isCanvasAgentDebugTraceEnabled()).toBe(false);

    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('PULSE_CANVAS_AGENT_OBSERVABILITY', '0');
    expect(isCanvasAgentDebugTraceEnabled()).toBe(false);

    vi.stubEnv('PULSE_CANVAS_AGENT_OBSERVABILITY', '1');
    expect(isCanvasAgentDebugTraceEnabled()).toBe(true);
  });

  it('records first activity once and computes the latency breakdown', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_200);
    const trace = createTrace();

    attachTraceRuntime(trace, 'pi-agent-harness');
    markTraceModelStarted(trace);
    vi.setSystemTime(1_260);
    recordTraceStreamEvent(trace, 'tool-call');
    vi.setSystemTime(1_320);
    recordTraceStreamEvent(trace, 'text');
    vi.setSystemTime(1_350);
    recordTraceStreamEvent(trace, 'text');
    vi.setSystemTime(1_450);
    markTraceRuntimeCompleted(trace);
    vi.setSystemTime(1_500);

    const finalized = finalizeCanvasAgentDebugTrace(trace)!;
    expect(finalized.performance).toMatchObject({
      queueMs: 25,
      scopeActivationMs: 50,
      contextPreparationMs: 100,
      modelStartDelayMs: 25,
      firstEventType: 'tool-call',
      timeToFirstEventMs: 60,
      timeToFirstTextMs: 120,
      runtimeMs: 250,
      responseProcessingMs: 50,
      totalMs: 500,
    });
    expect(finalized.durationMs).toBe(500);
    expect(finalized.runtime).toEqual({ id: 'pi-agent-harness' });
  });

  it('keeps first-text latency absent when a segment produces only tool activity', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_200);
    const trace = createTrace();
    markTraceModelStarted(trace);
    vi.setSystemTime(1_240);
    recordTraceStreamEvent(trace, 'tool-input');
    vi.setSystemTime(1_300);

    const timing = finalizeCanvasAgentDebugTrace(trace)!.performance!;
    expect(timing.timeToFirstEventMs).toBe(40);
    expect(timing.timeToFirstTextMs).toBeUndefined();
  });
});
