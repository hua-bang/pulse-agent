export type InitialLoadReleaseReason = 'complete' | 'failed' | 'timeout' | 'cancelled';

interface QueueEntry {
  id: string;
  priority: number;
  order: number;
  grant: () => void;
}

interface ActiveEntry {
  priority: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface InitialLoadHandle {
  cancel: () => void;
  updatePriority: (priority: number) => void;
}

export interface InitialLoadSnapshot {
  active: string[];
  queued: Array<{ id: string; priority: number }>;
  limit: number;
}

interface SchedulerOptions {
  foregroundPriorityThreshold?: number;
  limit?: number;
  timeoutMs?: number | null;
  onEvent?: (event: {
    id: string;
    type: 'queued' | 'granted' | 'released';
    reason?: InitialLoadReleaseReason;
    at: number;
  }) => void;
}

/**
 * Renderer-wide admission control for the expensive FIRST navigation of an
 * Electron webview. A granted webview stays mounted after release; this only
 * smooths the cold-start guest/process burst and never serializes ordinary
 * user navigation in an already-live tab.
 */
export class InitialWebviewLoadScheduler {
  private readonly active = new Map<string, ActiveEntry>();
  private readonly queued = new Map<string, QueueEntry>();
  private order = 0;
  private drainPending = false;
  private limit: number;
  private readonly foregroundPriorityThreshold: number;
  private readonly timeoutMs: number | null;
  private readonly onEvent?: SchedulerOptions['onEvent'];

  constructor({
    foregroundPriorityThreshold = 100,
    limit = 2,
    timeoutMs = null,
    onEvent,
  }: SchedulerOptions = {}) {
    this.limit = this.normalizeLimit(limit);
    this.foregroundPriorityThreshold = foregroundPriorityThreshold;
    this.timeoutMs = timeoutMs;
    this.onEvent = onEvent;
  }

  schedule(id: string, priority: number, grant: () => void): InitialLoadHandle {
    this.cancel(id);
    this.queued.set(id, { id, priority, order: this.order++, grant });
    this.emit(id, 'queued');
    // React mounts a visible batch in one commit. Drain in a microtask so all
    // requests from that commit enter the priority queue before slots are
    // awarded; otherwise DOM/effect order would defeat center/active priority.
    this.requestDrain();
    return {
      cancel: () => this.cancel(id),
      updatePriority: (nextPriority) => {
        const entry = this.queued.get(id);
        if (entry) entry.priority = nextPriority;
        const activeEntry = this.active.get(id);
        if (activeEntry) activeEntry.priority = nextPriority;
        this.requestDrain();
      },
    };
  }

  release(id: string, reason: InitialLoadReleaseReason): void {
    const entry = this.active.get(id);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.active.delete(id);
    this.emit(id, 'released', reason);
    this.requestDrain();
  }

  cancel(id: string): void {
    if (this.queued.delete(id)) this.emit(id, 'released', 'cancelled');
    this.release(id, 'cancelled');
  }

  configure(limit: number): void {
    this.limit = this.normalizeLimit(limit);
    this.requestDrain();
  }

  snapshot(): InitialLoadSnapshot {
    return {
      active: [...this.active.keys()],
      queued: this.sortedQueue().map(({ id, priority }) => ({ id, priority })),
      limit: this.limit === Number.POSITIVE_INFINITY ? 0 : this.limit,
    };
  }

  private normalizeLimit(limit: number): number {
    if (!Number.isFinite(limit) || limit <= 0) return Number.POSITIVE_INFINITY;
    return Math.max(1, Math.floor(limit));
  }

  private sortedQueue(): QueueEntry[] {
    return [...this.queued.values()].sort(
      (left, right) => left.priority - right.priority || left.order - right.order,
    );
  }

  private drain(): void {
    while (true) {
      const queue = this.sortedQueue();
      let entry = this.active.size < this.limit ? queue[0] : undefined;
      // One active Dock request may bypass a saturated background queue. This
      // is the user-action escape hatch: a pair of hung document loads must
      // not make a tab the user just selected wait indefinitely. It is capped
      // at one foreground overflow, so background startup remains bounded.
      if (!entry && this.limit !== Number.POSITIVE_INFINITY) {
        const activeForeground = [...this.active.values()].some(
          ({ priority }) => priority <= this.foregroundPriorityThreshold,
        );
        if (!activeForeground) {
          entry = queue.find(({ priority }) => priority <= this.foregroundPriorityThreshold);
        }
      }
      if (!entry) return;
      this.queued.delete(entry.id);
      const timer = this.timeoutMs === null
        ? null
        : setTimeout(() => this.release(entry.id, 'timeout'), this.timeoutMs);
      this.active.set(entry.id, { priority: entry.priority, timer });
      this.emit(entry.id, 'granted');
      entry.grant();
    }
  }

  private requestDrain(): void {
    if (this.drainPending) return;
    this.drainPending = true;
    queueMicrotask(() => {
      this.drainPending = false;
      this.drain();
    });
  }

  private emit(
    id: string,
    type: 'queued' | 'granted' | 'released',
    reason?: InitialLoadReleaseReason,
  ): void {
    this.onEvent?.({ id, type, reason, at: Math.round(performance.now()) });
  }
}

type PerfEvent = Parameters<NonNullable<SchedulerOptions['onEvent']>>[0];

declare global {
  interface Window {
    __pulseWebviewInitialLoads?: {
      events: PerfEvent[];
      snapshot: () => InitialLoadSnapshot;
    };
  }
}

const perfEvents: PerfEvent[] = [];
const runtimeConfig = typeof window === 'undefined'
  ? undefined
  : window.canvasWorkspace?.runtimeConfig;
const initialLimit = runtimeConfig?.webviewInitialLoadConcurrency ?? 2;

export const initialWebviewLoadScheduler = new InitialWebviewLoadScheduler({
  limit: initialLimit,
  onEvent: runtimeConfig?.perfMode ? (event) => perfEvents.push(event) : undefined,
});

if (runtimeConfig?.perfMode && typeof window !== 'undefined') {
  window.__pulseWebviewInitialLoads = {
    events: perfEvents,
    snapshot: () => initialWebviewLoadScheduler.snapshot(),
  };
}
