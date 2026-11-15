/**
 * Auto-dismiss timers for app-shell toasts.
 *
 * Only the newest `MAX_VISIBLE_TOASTS` toasts render. A timer runs only while
 * its toast is visible and the pointer is not over it, so a queued toast (for
 * example an Undo offer) keeps its full time until the user can see it.
 * Pausing keeps the remaining time; it does not restart the full duration.
 */
export const MAX_VISIBLE_TOASTS = 4;

export interface TimedToast {
  id: string;
  autoCloseMs?: number;
}

export const visibleToasts = <T>(toasts: readonly T[]): T[] => toasts.slice(-MAX_VISIBLE_TOASTS);

interface RunningTimer {
  handle: ReturnType<typeof setTimeout>;
  startedAt: number;
  durationMs: number;
}

export class ToastTimers {
  private readonly running = new Map<string, RunningTimer>();
  private readonly remaining = new Map<string, number>();
  private readonly hovered = new Set<string>();
  private visible: TimedToast[] = [];

  constructor(
    private readonly onExpire: (id: string) => void,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Starts timers for visible toasts and pauses timers for hidden ones. */
  sync(visible: readonly TimedToast[]): void {
    this.visible = [...visible];
    const visibleIds = new Set(visible.map((toast) => toast.id));
    for (const id of [...this.running.keys()]) {
      if (!visibleIds.has(id)) this.stop(id);
    }
    for (const toast of visible) {
      if (this.running.has(toast.id) || this.hovered.has(toast.id)) continue;
      const durationMs = this.remaining.get(toast.id) ?? toast.autoCloseMs ?? 0;
      if (durationMs <= 0) continue;
      this.start(toast.id, durationMs);
    }
  }

  /** Gives a toast a new full duration, for example after `updateToast`. */
  reset(id: string): void {
    this.clearTimer(id);
    this.remaining.delete(id);
  }

  pause(id: string): void {
    this.hovered.add(id);
    this.stop(id);
  }

  resume(id: string): void {
    this.hovered.delete(id);
    this.sync(this.visible);
  }

  remove(id: string): void {
    this.clearTimer(id);
    this.remaining.delete(id);
    this.hovered.delete(id);
  }

  clear(): void {
    for (const timer of this.running.values()) clearTimeout(timer.handle);
    this.running.clear();
    this.remaining.clear();
    this.hovered.clear();
    this.visible = [];
  }

  private start(id: string, durationMs: number): void {
    const handle = setTimeout(() => {
      this.running.delete(id);
      this.remaining.delete(id);
      this.onExpire(id);
    }, durationMs);
    this.running.set(id, { handle, startedAt: this.now(), durationMs });
  }

  /** Stops a running timer and keeps its remaining time. */
  private stop(id: string): void {
    const timer = this.running.get(id);
    if (!timer) return;
    clearTimeout(timer.handle);
    this.running.delete(id);
    const elapsed = this.now() - timer.startedAt;
    // Keep at least 1ms so a paused toast still expires after it resumes.
    this.remaining.set(id, Math.max(1, timer.durationMs - elapsed));
  }

  private clearTimer(id: string): void {
    const timer = this.running.get(id);
    if (!timer) return;
    clearTimeout(timer.handle);
    this.running.delete(id);
  }
}
