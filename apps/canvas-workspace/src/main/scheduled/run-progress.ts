import type { ScheduledRunProgress } from '../../shared/scheduled';

export interface RunProgressReporterOptions {
  taskId: string;
  emit: (progress: ScheduledRunProgress) => void;
  now?: () => number;
}

export interface RunProgressReporter {
  /** Publishes the initial `starting` state. */
  start(): void;
  onText(): void;
  onToolCall(name: string): void;
  onToolResult(): void;
  snapshot(): ScheduledRunProgress;
}

/**
 * Condenses an agent run's callback firehose into a handful of progress
 * pushes: one per ACTIVITY TRANSITION, never one per text delta. A single run
 * emits thousands of deltas and the progress line only ever shows a phase
 * name, so a per-delta push would be pure IPC noise — the elapsed timer that
 * proves liveness ticks in the renderer, off `startedAt`.
 */
export const createRunProgressReporter = (
  { taskId, emit, now = Date.now }: RunProgressReporterOptions,
): RunProgressReporter => {
  const startedAt = now();
  let current: ScheduledRunProgress = {
    taskId,
    startedAt,
    updatedAt: startedAt,
    activity: 'starting',
    steps: 0,
  };

  const publish = (patch: Partial<ScheduledRunProgress>): void => {
    current = { ...current, ...patch, updatedAt: now() };
    emit(current);
  };

  return {
    start: () => emit(current),
    onText: () => {
      if (current.activity === 'writing') return;
      publish({ activity: 'writing', toolName: undefined });
    },
    onToolCall: (name) => publish({
      activity: 'tool',
      toolName: name,
      steps: current.steps + 1,
    }),
    // The tool returned; the model is thinking again until it writes or calls
    // the next tool. Clearing `toolName` keeps the line from claiming a tool
    // is still running.
    onToolResult: () => publish({ activity: 'thinking', toolName: undefined }),
    snapshot: () => current,
  };
};
