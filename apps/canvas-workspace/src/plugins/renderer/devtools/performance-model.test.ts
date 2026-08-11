import { describe, expect, it } from 'vitest';

import type { AgentDebugTrace } from '../../../renderer/src/types';
import { buildPerformanceDiagnosis, buildTraceTimeline, runtimeDisplayName } from './performance-model';

const trace = (): AgentDebugTrace => ({
  sessionId: 'session-1',
  runId: 'run-1',
  turnId: 'turn-1',
  createdAt: 1_000,
  startedAt: 1_000,
  finishedAt: 1_500,
  durationMs: 500,
  request: {
    userPromptPreview: 'hello',
    attachmentCount: 0,
    selectedNodes: [],
    mentionedCanvases: [],
  },
  prompt: { systemPromptPreview: 'system', systemPromptChars: 6 },
  runtime: { id: 'pi-agent-harness' },
  performance: {
    requestStartedAt: 1_000,
    laneEnteredAt: 1_025,
    scopeReadyAt: 1_075,
    contextReadyAt: 1_175,
    modelStartedAt: 1_200,
    firstEventAt: 1_260,
    firstEventType: 'tool-call',
    firstTextAt: 1_320,
    runtimeCompletedAt: 1_450,
    completedAt: 1_500,
    totalMs: 500,
  },
  toolCalls: [],
  readNodes: [],
  contextReads: [],
});

describe('performance diagnosis model', () => {
  it('builds exclusive phases and global TTFA/TTFT milestones', () => {
    const model = buildPerformanceDiagnosis(trace())!;

    expect(model.phases.map(phase => [phase.id, phase.startMs, phase.durationMs])).toEqual([
      ['queue', 0, 25],
      ['scope', 25, 50],
      ['context', 75, 100],
      ['dispatch', 175, 25],
      ['runtime', 200, 250],
      ['response', 450, 50],
    ]);
    expect(model.phases.reduce((sum, phase) => sum + phase.durationMs, 0)).toBe(500);
    expect(model.milestones).toEqual([
      { id: 'ttfa', label: 'TTFA', atMs: 260, eventType: 'tool-call' },
      { id: 'ttft', label: 'TTFT', atMs: 320 },
    ]);
    expect(model.hostBeforeRuntimeMs).toBe(200);
    expect(model.hostTotalMs).toBe(250);
    expect(model.bottleneck?.id).toBe('runtime');
    expect(model.runtimeOwner).toBe('pi');
  });

  it('keeps milestones out of additive phase totals', () => {
    const model = buildPerformanceDiagnosis(trace())!;
    const phaseIds = model.phases.map(phase => phase.id);

    expect(phaseIds).not.toContain('ttfa');
    expect(phaseIds).not.toContain('ttft');
    expect(model.milestones).toHaveLength(2);
  });

  it('labels both supported runtime implementations', () => {
    expect(runtimeDisplayName('engine')).toBe('Engine');
    expect(runtimeDisplayName('pi-agent-harness')).toBe('Pi');
    expect(runtimeDisplayName('custom-runtime')).toBe('custom-runtime');
  });

  it('builds owner-attributed spans from bus events', () => {
    const input = trace();
    input.observabilityEvents = [
      { type: 'run.started', runId: 'run-1', timestamp: 1_000, scope: 'global', host: 'canvas' },
      { type: 'generation.started', runId: 'run-1', timestamp: 1_200, generationId: 'g1', owner: 'pi', model: 'test' },
      { type: 'milestone', runId: 'run-1', timestamp: 1_260, milestone: 'runtime.first-activity', owner: 'pi' },
      { type: 'generation.completed', runId: 'run-1', timestamp: 1_450, generationId: 'g1', owner: 'pi', finishReason: 'stop' },
      { type: 'milestone', runId: 'run-1', timestamp: 1_470, milestone: 'ui.first-content-rendered', owner: 'renderer' },
    ];

    const timeline = buildTraceTimeline(input)!;
    expect(timeline.items.find(item => item.kind === 'generation')).toMatchObject({
      owner: 'pi', startMs: 200, durationMs: 250,
    });
    expect(timeline.milestones).toEqual({ ttfa: 260, render: 470 });
    expect(timeline.bottleneck?.label).toBe('LLM generation');
  });
});
