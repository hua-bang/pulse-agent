import type { AgentDebugTrace } from '../../../renderer/src/types';
import type { AgentTraceEvent } from '../../../shared/agent-observability';

export type PerformanceOwner = 'canvas-host' | 'engine' | 'pi' | 'runtime';

export interface PerformancePhase {
  id: 'queue' | 'scope' | 'context' | 'dispatch' | 'runtime' | 'response';
  label: string;
  owner: PerformanceOwner;
  startMs: number;
  durationMs: number;
  endMs: number;
  percent: number;
}

export interface PerformanceMilestone {
  id: 'ttfa' | 'ttft';
  label: 'TTFA' | 'TTFT';
  atMs: number;
  eventType?: string;
}

export interface PerformanceDiagnosis {
  totalMs: number;
  hostBeforeRuntimeMs: number;
  hostTotalMs: number;
  runtimeOwner: PerformanceOwner;
  phases: PerformancePhase[];
  milestones: PerformanceMilestone[];
  bottleneck?: PerformancePhase;
}

export interface TraceTimelineItem {
  id: string;
  label: string;
  owner: PerformanceOwner | 'renderer';
  kind: 'phase' | 'generation' | 'tool' | 'milestone' | 'compaction';
  startMs: number;
  durationMs: number;
  endMs: number;
  detail?: string;
  status?: 'success' | 'error';
}

export interface TraceTimeline {
  totalMs: number;
  items: TraceTimelineItem[];
  milestones: Partial<Record<'ttfa' | 'ttft' | 'render' | 'completed', number>>;
  bottleneck?: TraceTimelineItem;
}

const nonNegative = (value: number): number => Math.max(0, value);

export const runtimeOwner = (runtimeId?: string): PerformanceOwner => {
  if (runtimeId === 'engine') return 'engine';
  if (runtimeId === 'pi-agent-harness') return 'pi';
  return 'runtime';
};

export const runtimeDisplayName = (runtimeId?: string): string => {
  const owner = runtimeOwner(runtimeId);
  if (owner === 'engine') return 'Engine';
  if (owner === 'pi') return 'Pi';
  return runtimeId ?? 'Runtime';
};

export function buildPerformanceDiagnosis(
  trace: AgentDebugTrace,
): PerformanceDiagnosis | undefined {
  const timing = trace.performance;
  if (!timing) return undefined;

  const origin = timing.requestStartedAt;
  const completedAt = timing.completedAt ?? trace.finishedAt;
  const totalMs = nonNegative(
    timing.totalMs
      ?? (completedAt == null ? trace.durationMs ?? 0 : completedAt - origin),
  );
  const owner = runtimeOwner(trace.runtime?.id);
  const rawPhases: Array<Omit<PerformancePhase, 'endMs' | 'percent'>> = [
    {
      id: 'queue',
      label: 'Session queue',
      owner: 'canvas-host',
      startMs: 0,
      durationMs: nonNegative(timing.laneEnteredAt - origin),
    },
    {
      id: 'scope',
      label: 'Scope activation',
      owner: 'canvas-host',
      startMs: nonNegative(timing.laneEnteredAt - origin),
      durationMs: nonNegative(timing.scopeReadyAt - timing.laneEnteredAt),
    },
    {
      id: 'context',
      label: 'Context preparation',
      owner: 'canvas-host',
      startMs: nonNegative(timing.scopeReadyAt - origin),
      durationMs: nonNegative(timing.contextReadyAt - timing.scopeReadyAt),
    },
  ];

  if (timing.modelStartedAt != null) {
    rawPhases.push({
      id: 'dispatch',
      label: 'Runtime dispatch',
      owner: 'canvas-host',
      startMs: nonNegative(timing.contextReadyAt - origin),
      durationMs: nonNegative(timing.modelStartedAt - timing.contextReadyAt),
    });

    const runtimeCompletedAt = timing.runtimeCompletedAt ?? completedAt ?? timing.modelStartedAt;
    rawPhases.push({
      id: 'runtime',
      label: `${runtimeDisplayName(trace.runtime?.id)} runtime`,
      owner,
      startMs: nonNegative(timing.modelStartedAt - origin),
      durationMs: nonNegative(runtimeCompletedAt - timing.modelStartedAt),
    });

    if (completedAt != null) {
      rawPhases.push({
        id: 'response',
        label: 'Response processing',
        owner: 'canvas-host',
        startMs: nonNegative(runtimeCompletedAt - origin),
        durationMs: nonNegative(completedAt - runtimeCompletedAt),
      });
    }
  }

  const phases = rawPhases.map((phase): PerformancePhase => ({
    ...phase,
    endMs: phase.startMs + phase.durationMs,
    percent: totalMs === 0 ? 0 : (phase.durationMs / totalMs) * 100,
  }));
  const milestones: PerformanceMilestone[] = [];
  if (timing.firstEventAt != null) {
    milestones.push({
      id: 'ttfa',
      label: 'TTFA',
      atMs: nonNegative(timing.firstEventAt - origin),
      eventType: timing.firstEventType,
    });
  }
  if (timing.firstTextAt != null) {
    milestones.push({
      id: 'ttft',
      label: 'TTFT',
      atMs: nonNegative(timing.firstTextAt - origin),
    });
  }

  const hostBeforeRuntimeMs = phases
    .filter(phase => phase.owner === 'canvas-host' && phase.id !== 'response')
    .reduce((sum, phase) => sum + phase.durationMs, 0);
  const hostTotalMs = phases
    .filter(phase => phase.owner === 'canvas-host')
    .reduce((sum, phase) => sum + phase.durationMs, 0);
  const bottleneck = phases.reduce<PerformancePhase | undefined>(
    (largest, phase) => !largest || phase.durationMs > largest.durationMs ? phase : largest,
    undefined,
  );

  return {
    totalMs,
    hostBeforeRuntimeMs,
    hostTotalMs,
    runtimeOwner: owner,
    phases,
    milestones,
    bottleneck,
  };
}

const eventOwner = (owner: string): TraceTimelineItem['owner'] => {
  if (owner === 'canvas-host' || owner === 'engine' || owner === 'pi' || owner === 'renderer') {
    return owner;
  }
  return 'runtime';
};

const phaseLabel = (phase: string): string => ({
  'renderer.request-dispatch': 'Request dispatch',
  'canvas.queue': 'Session queue',
  'canvas.scope-activation': 'Scope activation',
  'canvas.scope.availability-check': 'Scope › Workspace availability',
  'canvas.scope.wait-idle': 'Scope › Wait for session writes',
  'canvas.scope.agent-init': 'Scope › Agent init',
  'canvas.scope.agent-init-wait': 'Scope › Wait for in-flight agent init',
  'canvas.scope.engine-init': 'Scope › Engine init',
  'canvas.scope.engine-plugin-init': 'Scope › Engine plugin',
  'canvas.scope.mcp-server': 'Scope › MCP server',
  'canvas.scope.session-restore': 'Scope › Session restore',
  'canvas.scope.session-reconcile': 'Scope › Session reconcile',
  'canvas.context-preparation': 'Context preparation',
  'canvas.runtime-dispatch': 'Runtime dispatch',
  'runtime.execution': 'Runtime execution',
  'canvas.response-processing': 'Response processing',
  'canvas.persistence': 'Save conversation',
}[phase] ?? phase);

type GenerationCompletedEvent = Extract<AgentTraceEvent, { type: 'generation.completed' }>;

const formatTokens = (value: number): string => (
  value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value)
);

/** Duration stays first because an item's detail replaces its duration in the waterfall. */
const generationDetail = (
  durationMs: number,
  finishReason: string | undefined,
  usage: GenerationCompletedEvent['usage'],
): string => {
  const parts = [durationMs >= 1000 ? `${(durationMs / 1000).toFixed(2)}s` : `${durationMs}ms`];
  if (usage?.inputTokens !== undefined) {
    const cached = usage.cachedInputTokens ? ` (cached ${formatTokens(usage.cachedInputTokens)})` : '';
    parts.push(`in ${formatTokens(usage.inputTokens)}${cached}`);
  }
  if (usage?.outputTokens !== undefined) {
    const reasoning = usage.reasoningTokens ? ` (reasoning ${formatTokens(usage.reasoningTokens)})` : '';
    parts.push(`out ${formatTokens(usage.outputTokens)}${reasoning}`);
  }
  if (finishReason) parts.push(finishReason);
  return parts.join(' · ');
};

/**
 * Split one provider call at the boundaries the runtime reported: request
 * preparation, waiting for the first chunk (provider queue + prefill), output
 * before any text (reasoning or tool input), and text streaming.
 */
const generationSegments = (
  event: GenerationCompletedEvent,
  startedAt: number,
  origin: number,
): TraceTimelineItem[] => {
  const timings = event.timings;
  if (!timings) return [];
  const bounds: Array<[string, number | undefined, number | undefined]> = [
    ['Request preparation', startedAt, timings.requestStartedAt],
    ['Wait for first chunk', timings.requestStartedAt, timings.firstChunkAt],
    ['Output before text', timings.firstChunkAt, timings.firstTextAt],
    ['Text streaming', timings.firstTextAt, event.timestamp],
  ];
  return bounds.flatMap(([label, from, to]) => {
    if (from === undefined || to === undefined || to <= from) return [];
    return [{
      id: `generation:${event.generationId}:${label}`,
      label: `Generation › ${label}`,
      owner: eventOwner(event.owner),
      kind: 'generation' as const,
      startMs: Math.max(0, from - origin),
      durationMs: to - from,
      endMs: Math.max(0, to - origin),
    }];
  });
};

export function buildTraceTimeline(trace: AgentDebugTrace): TraceTimeline | undefined {
  const events = trace.observabilityEvents ?? [];
  const diagnosis = buildPerformanceDiagnosis(trace);
  const origin = events.find(event => event.type === 'milestone' && event.milestone === 'ui.request-dispatched')?.timestamp
    ?? events.find(event => event.type === 'run.started')?.timestamp
    ?? trace.performance?.requestStartedAt
    ?? trace.startedAt;
  const completedAt = events.find(event => event.type === 'run.completed')?.timestamp;
  const totalMs = completedAt === undefined
    ? diagnosis?.totalMs ?? Math.max(0, (trace.finishedAt ?? origin) - origin)
    : Math.max(0, completedAt - origin);

  if (events.length === 0) {
    if (!diagnosis) return undefined;
    const items = diagnosis.phases.map(phase => ({
      id: `phase:${phase.id}`,
      label: phase.label,
      owner: phase.owner,
      kind: 'phase' as const,
      startMs: phase.startMs,
      durationMs: phase.durationMs,
      endMs: phase.endMs,
    }));
    return {
      totalMs,
      items,
      milestones: {
        ttfa: diagnosis.milestones.find(item => item.id === 'ttfa')?.atMs,
        ttft: diagnosis.milestones.find(item => item.id === 'ttft')?.atMs,
      },
      bottleneck: items.reduce<TraceTimelineItem | undefined>(
        (largest, item) => !largest || item.durationMs > largest.durationMs ? item : largest,
        undefined,
      ),
    };
  }

  const starts = new Map<string, typeof events[number]>();
  const items: TraceTimelineItem[] = [];
  const milestones: TraceTimeline['milestones'] = {};
  for (const event of events) {
    if (event.type === 'generation.started') starts.set(`generation:${event.generationId}`, event);
    if (event.type === 'tool.started') starts.set(`tool:${event.toolCallId}`, event);
    if (event.type === 'phase.completed') {
      items.push({
        // Nested steps (e.g. repeated availability checks) can share a start millisecond.
        id: `phase:${event.phase}:${event.startedAt}:${items.length}`,
        label: event.detail ? `${phaseLabel(event.phase)} · ${event.detail}` : phaseLabel(event.phase),
        owner: eventOwner(event.owner), kind: 'phase',
        startMs: Math.max(0, event.startedAt - origin),
        durationMs: Math.max(0, event.finishedAt - event.startedAt),
        endMs: Math.max(0, event.finishedAt - origin),
      });
    }
    if (event.type === 'generation.completed') {
      const start = starts.get(`generation:${event.generationId}`);
      const startedAt = start?.timestamp ?? event.timestamp;
      items.push({
        id: `generation:${event.generationId}`, label: 'LLM generation',
        owner: eventOwner(event.owner), kind: 'generation',
        startMs: Math.max(0, startedAt - origin),
        durationMs: Math.max(0, event.timestamp - startedAt),
        endMs: Math.max(0, event.timestamp - origin),
        detail: generationDetail(event.timestamp - startedAt, event.finishReason, event.usage),
        status: event.error ? 'error' : 'success',
      });
      items.push(...generationSegments(event, startedAt, origin));
    }
    if (event.type === 'tool.completed') {
      const start = starts.get(`tool:${event.toolCallId}`);
      const startedAt = start?.timestamp ?? event.timestamp;
      items.push({
        id: `tool:${event.toolCallId}`, label: event.toolName,
        owner: eventOwner(event.owner), kind: 'tool',
        startMs: Math.max(0, startedAt - origin),
        durationMs: Math.max(0, event.timestamp - startedAt),
        endMs: Math.max(0, event.timestamp - origin),
        status: event.status === 'error' ? 'error' : 'success',
      });
    }
    if (event.type === 'milestone') {
      const atMs = Math.max(0, event.timestamp - origin);
      if (event.milestone === 'runtime.first-activity' && milestones.ttfa == null) milestones.ttfa = atMs;
      if (event.milestone === 'runtime.first-text' && milestones.ttft == null) milestones.ttft = atMs;
      if (event.milestone === 'ui.response-completed' && milestones.completed == null) milestones.completed = atMs;
      if (event.milestone === 'ui.first-content-rendered' && milestones.render == null) milestones.render = atMs;
      items.push({
        id: `milestone:${event.milestone}:${event.timestamp}`,
        label: event.milestone, owner: eventOwner(event.owner), kind: 'milestone',
        startMs: atMs, durationMs: 0, endMs: atMs, detail: event.detail,
      });
    }
    if (event.type === 'context.compacted') {
      const atMs = Math.max(0, event.timestamp - origin);
      items.push({
        id: `compaction:${event.timestamp}`, label: 'Context compacted',
        owner: eventOwner(event.owner), kind: 'compaction',
        startMs: atMs, durationMs: 0, endMs: atMs,
        detail: event.beforeTokens == null ? undefined
          : `${event.beforeTokens} → ${event.afterTokens ?? '?'} tokens`,
      });
    }
  }
  items.sort((left, right) => left.startMs - right.startMs || right.durationMs - left.durationMs);
  return {
    totalMs,
    items,
    milestones,
    bottleneck: items.filter(item => item.durationMs > 0).reduce<TraceTimelineItem | undefined>(
      (largest, item) => !largest || item.durationMs > largest.durationMs ? item : largest,
      undefined,
    ),
  };
}
