import type {
  AgentObservabilitySubscriber,
  AgentTraceEvent,
} from '../../shared/agent-observability';

const MAX_RUNS = 200;
const MAX_EVENTS_PER_RUN = 500;

/** Run boundaries anchor every duration, so the event cap never drops them. */
const isRunBoundary = (event: AgentTraceEvent) =>
  event.type === 'run.started' || event.type === 'run.completed';

export class LocalAgentTraceSink implements AgentObservabilitySubscriber {
  readonly id = 'devtools-local-trace';
  private readonly eventsByRun = new Map<string, AgentTraceEvent[]>();

  onEvent(event: AgentTraceEvent): void {
    if (event.type === 'run.started') this.eventsByRun.delete(event.runId);
    const events = this.eventsByRun.get(event.runId) ?? [];
    events.push(event);
    if (events.length > MAX_EVENTS_PER_RUN) {
      const oldest = events.findIndex(item => !isRunBoundary(item));
      if (oldest >= 0) events.splice(oldest, 1);
    }
    this.eventsByRun.set(event.runId, events);

    while (this.eventsByRun.size > MAX_RUNS) {
      const oldestRunId = this.eventsByRun.keys().next().value;
      if (!oldestRunId) break;
      this.eventsByRun.delete(oldestRunId);
    }
  }

  snapshot(runId: string): AgentTraceEvent[] {
    return [...(this.eventsByRun.get(runId) ?? [])]
      .sort((left, right) => left.timestamp - right.timestamp);
  }
}
