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

  it('splits a generation at reported provider boundaries and labels repeated steps', () => {
    const input = trace();
    input.observabilityEvents = [
      { type: 'run.started', runId: 'run-1', timestamp: 1_000, scope: 'workspace', host: 'canvas' },
      {
        type: 'phase.completed', runId: 'run-1', timestamp: 1_080, phase: 'canvas.scope.mcp-server',
        owner: 'canvas-host', startedAt: 1_010, finishedAt: 1_080,
        parentPhase: 'canvas.scope-activation', detail: 'exa · connect 50ms · tools 20ms',
      },
      { type: 'generation.started', runId: 'run-1', timestamp: 1_200, generationId: 'g1', owner: 'engine' },
      {
        type: 'generation.completed', runId: 'run-1', timestamp: 2_000, generationId: 'g1', owner: 'engine',
        finishReason: 'stop',
        timings: { requestStartedAt: 1_210, firstChunkAt: 1_700, firstTextAt: 1_900 },
        usage: { inputTokens: 8_100, cachedInputTokens: 7_900, outputTokens: 300, reasoningTokens: 120 },
      },
    ];

    const timeline = buildTraceTimeline(input)!;
    const segments = timeline.items
      .filter(item => item.label.startsWith('Generation ›'))
      .map(item => [item.label, item.startMs, item.durationMs]);
    expect(segments).toEqual([
      ['Generation › Request preparation', 200, 10],
      ['Generation › Wait for first chunk', 210, 490],
      ['Generation › Output before text', 700, 200],
      ['Generation › Text streaming', 900, 100],
    ]);
    expect(timeline.items.find(item => item.label === 'LLM generation')?.detail)
      .toBe('800ms · in 8.1k (cached 7.9k) · out 300 (reasoning 120) · stop');
    expect(timeline.items.some(item => item.label === 'Scope › MCP server · exa · connect 50ms · tools 20ms'))
      .toBe(true);
  });
});


it('measures submission to durable host completion and UI completion separately', () => {
  const input = trace();
  input.observabilityEvents = [
    { type: 'run.started', runId: 'run-1', timestamp: 1000, scope: 'global', host: 'canvas' },
    { type: 'milestone', runId: 'run-1', timestamp: 900, milestone: 'ui.request-dispatched', owner: 'renderer' },
    { type: 'milestone', runId: 'run-1', timestamp: 1200, milestone: 'runtime.first-text', owner: 'engine' },
    { type: 'milestone', runId: 'run-1', timestamp: 1250, milestone: 'ui.first-content-rendered', owner: 'renderer' },
    { type: 'run.completed', runId: 'run-1', timestamp: 1700, status: 'success' },
    { type: 'milestone', runId: 'run-1', timestamp: 1800, milestone: 'ui.response-completed', owner: 'renderer' },
  ];
  expect(buildTraceTimeline(input)).toMatchObject({
    totalMs: 800, milestones: { ttft: 300, render: 350, completed: 900 },
  });
});
