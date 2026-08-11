import type { AgentDebugTrace } from '../../../renderer/src/types';

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
  milestones: Partial<Record<'ttfa' | 'ttft' | 'render', number>>;
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
  'canvas.context-preparation': 'Context preparation',
  'canvas.runtime-dispatch': 'Runtime dispatch',
  'runtime.execution': 'Runtime execution',
  'canvas.response-processing': 'Response processing',
}[phase] ?? phase);

export function buildTraceTimeline(trace: AgentDebugTrace): TraceTimeline | undefined {
  const events = trace.observabilityEvents ?? [];
  const diagnosis = buildPerformanceDiagnosis(trace);
  const origin = events.find(event => event.type === 'run.started')?.timestamp
    ?? trace.performance?.requestStartedAt
    ?? trace.startedAt;
  const totalMs = diagnosis?.totalMs ?? Math.max(0, (trace.finishedAt ?? origin) - origin);

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
        id: `phase:${event.phase}:${event.startedAt}`,
        label: phaseLabel(event.phase), owner: eventOwner(event.owner), kind: 'phase',
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
        detail: event.finishReason,
        status: event.error ? 'error' : 'success',
      });
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
