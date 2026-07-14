export type WebviewLifecycleState =
  | 'deferred'
  | 'live'
  | 'discarding'
  | 'discarded'
  | 'restoring';

export interface WebviewLifecyclePolicy {
  liveCap: number;
  offscreenGraceMs: number;
  discardProbeTimeoutMs?: number;
}

interface Registration {
  id: string;
  nodeId: string;
  canDiscard: () => boolean | Promise<boolean>;
  onDiscard: () => void;
  onWake: (restoring: boolean) => void;
}

interface Entry extends Registration {
  active: boolean;
  explicitProtection: boolean;
  lastActiveAt: number;
  mounted: boolean;
  near: boolean;
  offscreenSince: number | null;
  order: number;
  probeTimeouts: number;
  retryAfter: number;
  state: WebviewLifecycleState;
}

export interface WebviewLifecycleSnapshot {
  liveCap: number;
  liveCount: number;
  discardedCount: number;
  entries: Array<{
    id: string;
    nodeId: string;
    state: WebviewLifecycleState;
    active: boolean;
    protected: boolean;
    lastActiveAt: number;
  }>;
}

export interface WebviewLifecycleHandle {
  markReady: () => void;
  setProtected: (protectedState: boolean) => void;
  setVisibility: (visibility: { near: boolean; active: boolean }) => void;
  touch: () => void;
  unregister: () => void;
  wake: () => void;
}

const DEFAULT_POLICY: WebviewLifecyclePolicy = {
  liveCap: 16,
  offscreenGraceMs: 60_000,
  discardProbeTimeoutMs: 2_500,
};
const MAX_SLOW_PROBES_PER_PASS = 2;
const PROBE_BACKOFF_BASE_MS = 5_000;
const PROBE_BACKOFF_MAX_MS = 60_000;
const SLOW_PROBE_PASS_COOLDOWN_MS = 5_000;

interface TimeoutOutcome<T> {
  timedOut: boolean;
  value: T;
}

const withTimeoutFallback = <T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<TimeoutOutcome<T>> => (
  new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ timedOut: true, value: fallback });
    }, timeoutMs);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ timedOut: false, value });
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ timedOut: false, value: fallback });
      },
    );
  })
);

export class WebviewLifecycleCoordinator {
  private readonly entries = new Map<string, Entry>();
  private nextOrder = 0;
  private reconcileNotBefore = 0;
  private reconcilePromise: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly policy: WebviewLifecyclePolicy = DEFAULT_POLICY,
    private readonly now: () => number = Date.now,
  ) {}

  register(registration: Registration): WebviewLifecycleHandle {
    this.unregister(registration.id);
    const entry: Entry = {
      ...registration,
      active: false,
      explicitProtection: false,
      lastActiveAt: this.now(),
      mounted: false,
      near: false,
      offscreenSince: null,
      order: this.nextOrder++,
      probeTimeouts: 0,
      retryAfter: 0,
      state: 'deferred',
    };
    this.entries.set(entry.id, entry);

    const withCurrent = (action: (current: Entry) => void): void => {
      if (this.entries.get(entry.id) === entry) action(entry);
    };

    return {
      markReady: () => withCurrent((current) => {
        if (current.mounted) current.state = 'live';
      }),
      setProtected: (protectedState) => withCurrent((current) => {
        if (current.explicitProtection === protectedState) return;
        current.explicitProtection = protectedState;
        if (protectedState) {
          this.touchEntry(current);
          this.wakeEntry(current);
        } else if (!current.active) {
          current.offscreenSince = this.now();
        }
        this.scheduleReconcile();
      }),
      setVisibility: ({ near, active }) => withCurrent((current) => {
        const wasActive = current.active;
        current.near = near;
        current.active = active;
        if (near) this.wakeEntry(current);
        if (active) {
          this.touchEntry(current);
        } else if (wasActive || current.offscreenSince === null) {
          current.offscreenSince = this.now();
        }
        this.scheduleReconcile();
      }),
      touch: () => withCurrent((current) => {
        this.touchEntry(current);
        if (!current.active && !current.explicitProtection) {
          current.offscreenSince = this.now();
        }
        this.scheduleReconcile();
      }),
      unregister: () => this.unregister(entry.id, entry),
      wake: () => withCurrent((current) => this.wakeEntry(current)),
    };
  }

  async reconcile(options: { ignoreGrace?: boolean } = {}): Promise<WebviewLifecycleSnapshot> {
    if (this.reconcilePromise) {
      await this.reconcilePromise;
      return this.snapshot();
    }
    this.clearTimer();
    this.reconcilePromise = this.runReconcile(options.ignoreGrace === true);
    try {
      await this.reconcilePromise;
    } finally {
      this.reconcilePromise = null;
      this.scheduleReconcile();
    }
    return this.snapshot();
  }

  snapshot(): WebviewLifecycleSnapshot {
    const entries = [...this.entries.values()]
      .sort((a, b) => a.order - b.order)
      .map((entry) => ({
        id: entry.id,
        nodeId: entry.nodeId,
        state: entry.state,
        active: entry.active,
        protected: entry.explicitProtection,
        lastActiveAt: entry.lastActiveAt,
      }));
    return {
      liveCap: this.policy.liveCap,
      liveCount: entries.filter((entry) => ['live', 'discarding', 'restoring'].includes(entry.state)).length,
      discardedCount: entries.filter((entry) => entry.state === 'discarded').length,
      entries,
    };
  }

  wake(id: string): void {
    const entry = this.entries.get(id);
    if (entry) this.wakeEntry(entry);
  }

  reset(): void {
    this.clearTimer();
    this.entries.clear();
    this.nextOrder = 0;
    this.reconcileNotBefore = 0;
  }

  private async runReconcile(ignoreGrace: boolean): Promise<void> {
    if (this.now() < this.reconcileNotBefore) return;
    const attempted = new Set<string>();
    let slowProbes = 0;
    while (this.liveCount() > this.policy.liveCap) {
      const candidate = [...this.entries.values()]
        .filter((entry) => !attempted.has(entry.id) && this.isEligible(entry, ignoreGrace))
        .sort((a, b) => a.lastActiveAt - b.lastActiveAt || a.order - b.order)[0];
      if (!candidate) return;
      attempted.add(candidate.id);
      candidate.state = 'discarding';

      const probeTimeoutMs = this.policy.discardProbeTimeoutMs
        ?? DEFAULT_POLICY.discardProbeTimeoutMs!;
      const probeStartedAt = this.now();
      let outcome: TimeoutOutcome<boolean> = { timedOut: false, value: false };
      try {
        outcome = await withTimeoutFallback(
          Promise.resolve().then(candidate.canDiscard),
          probeTimeoutMs,
          false,
        );
      } catch {
        outcome = { timedOut: false, value: false };
      }
      const probeDurationMs = Math.max(0, this.now() - probeStartedAt);
      const slowProbeThresholdMs = Math.min(1_000, Math.max(1, probeTimeoutMs * 0.8));
      const wasSlowFailure = !outcome.value
        && (outcome.timedOut || probeDurationMs >= slowProbeThresholdMs);
      if (wasSlowFailure) slowProbes += 1;

      if (this.entries.get(candidate.id) !== candidate) {
        if (slowProbes >= MAX_SLOW_PROBES_PER_PASS) {
          this.reconcileNotBefore = this.now() + SLOW_PROBE_PASS_COOLDOWN_MS;
          return;
        }
        continue;
      }
      if (wasSlowFailure) {
        candidate.probeTimeouts += 1;
        const exponentialBackoff = Math.min(
          PROBE_BACKOFF_MAX_MS,
          PROBE_BACKOFF_BASE_MS * (2 ** (candidate.probeTimeouts - 1)),
        );
        candidate.retryAfter = this.now() + Math.max(
          this.policy.offscreenGraceMs,
          exponentialBackoff,
        );
      } else {
        candidate.probeTimeouts = 0;
        candidate.retryAfter = 0;
      }
      if (!outcome.value || !this.isEligible(candidate, ignoreGrace, true)) {
        candidate.state = candidate.mounted ? 'live' : 'discarded';
        if (!outcome.value && candidate.mounted && !candidate.active && !candidate.explicitProtection) {
          candidate.lastActiveAt = this.now();
          candidate.offscreenSince = this.now();
          if (!wasSlowFailure) {
            candidate.retryAfter = this.now() + Math.max(
              this.policy.offscreenGraceMs,
              PROBE_BACKOFF_BASE_MS,
            );
          }
        }
        if (slowProbes >= MAX_SLOW_PROBES_PER_PASS) {
          this.reconcileNotBefore = this.now() + SLOW_PROBE_PASS_COOLDOWN_MS;
          return;
        }
        continue;
      }

      candidate.mounted = false;
      candidate.state = 'discarded';
      try {
        candidate.onDiscard();
      } catch {
        candidate.mounted = true;
        candidate.state = 'live';
        candidate.lastActiveAt = this.now();
        candidate.offscreenSince = this.now();
      }
    }
  }

  private isEligible(entry: Entry, ignoreGrace: boolean, allowDiscarding = false): boolean {
    if (!entry.mounted || entry.active || entry.explicitProtection) return false;
    if (!allowDiscarding && entry.state === 'discarding') return false;
    if (entry.offscreenSince === null) return false;
    if (this.now() < entry.retryAfter) return false;
    return ignoreGrace || this.now() - entry.offscreenSince >= this.policy.offscreenGraceMs;
  }

  private liveCount(): number {
    return [...this.entries.values()].filter((entry) => entry.mounted).length;
  }

  private touchEntry(entry: Entry): void {
    entry.lastActiveAt = this.now();
    entry.offscreenSince = null;
    entry.probeTimeouts = 0;
    entry.retryAfter = 0;
  }

  private wakeEntry(entry: Entry): void {
    if (entry.mounted) return;
    const restoring = entry.state === 'discarded';
    entry.mounted = true;
    entry.state = restoring ? 'restoring' : 'live';
    entry.lastActiveAt = this.now();
    entry.offscreenSince = entry.active || entry.explicitProtection ? null : this.now();
    entry.onWake(restoring);
    this.scheduleReconcile();
  }

  private unregister(id: string, expected?: Entry): void {
    const current = this.entries.get(id);
    if (!current || (expected && current !== expected)) return;
    this.entries.delete(id);
    this.scheduleReconcile();
  }

  private scheduleReconcile(): void {
    this.clearTimer();
    if (this.liveCount() <= this.policy.liveCap) return;
    const now = this.now();
    const dueAt = [...this.entries.values()]
      .filter((entry) => entry.mounted && !entry.active && !entry.explicitProtection && entry.offscreenSince !== null)
      .map((entry) => Math.max(
        entry.offscreenSince! + this.policy.offscreenGraceMs,
        entry.retryAfter,
        this.reconcileNotBefore,
      ))
      .sort((a, b) => a - b)[0];
    if (dueAt === undefined) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.reconcile();
    }, Math.max(0, dueAt - now));
    if (typeof this.timer === 'object' && 'unref' in this.timer) this.timer.unref();
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

export const webviewLifecycleCoordinator = new WebviewLifecycleCoordinator();

export interface PulseWebviewLifecycleApi {
  forceReconcile: () => Promise<WebviewLifecycleSnapshot>;
  snapshot: () => WebviewLifecycleSnapshot;
  wake: (id: string) => void;
}

declare global {
  interface Window {
    __pulseWebviewLifecycle?: PulseWebviewLifecycleApi;
  }
}

export const installWebviewLifecycleDebugApi = (): void => {
  if (window.__pulseWebviewLifecycle) return;
  window.__pulseWebviewLifecycle = {
    forceReconcile: () => webviewLifecycleCoordinator.reconcile({ ignoreGrace: true }),
    snapshot: () => webviewLifecycleCoordinator.snapshot(),
    wake: (id) => webviewLifecycleCoordinator.wake(id),
  };
};
