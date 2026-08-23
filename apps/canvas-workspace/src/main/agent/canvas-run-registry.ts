import { ClarificationRegistry } from './clarification-registry';
import type { CanvasClarificationRequest } from './canvas-agent';

/** Per-conversation run controls (cancellation, relay stop, clarifications). */
export interface ActiveRunState {
  abortController: AbortController;
  relayStop: { stopped: boolean };
  clarifications: ClarificationRegistry;
}

/**
 * Owns per-conversation run state. Multiple conversations in the same
 * workspace can stream concurrently, so cancellation/relay/clarification are
 * scoped to the run's anchored conversation session rather than a single
 * "current" turn. The coordinator guarantees at most one run per session.
 */
export class CanvasRunRegistry {
  private runs = new Map<string, ActiveRunState>();
  /** Most recently started run, for legacy scope-level controls without a session. */
  private recentRunKey: string | null = null;

  start(sessionId: string, abortController: AbortController): ActiveRunState {
    const run: ActiveRunState = {
      abortController,
      relayStop: { stopped: false },
      clarifications: new ClarificationRegistry(),
    };
    this.runs.set(sessionId, run);
    this.recentRunKey = sessionId;
    return run;
  }

  stop(sessionId: string, run: ActiveRunState): void {
    if (this.runs.get(sessionId) !== run) return;
    this.runs.delete(sessionId);
    if (this.recentRunKey === sessionId) {
      this.recentRunKey = this.runs.keys().next().value ?? null;
    }
    run.clarifications.cancelAll();
  }

  private runFor(sessionId?: string): ActiveRunState | undefined {
    return sessionId
      ? this.runs.get(sessionId)
      : (this.recentRunKey ? this.runs.get(this.recentRunKey) : undefined);
  }

  /** Abort the run for `sessionId`, or the most recent run without one. */
  abort(sessionId?: string): void {
    this.runFor(sessionId)?.abortController.abort();
  }

  /** Graceful relay stop; returns false when no run is active. */
  stopRelay(sessionId?: string): boolean {
    const run = this.runFor(sessionId);
    if (!run) return false;
    run.relayStop.stopped = true;
    return true;
  }

  /** Deliver a clarification answer to whichever run is waiting on it. */
  answerClarification(requestId: string, answer: string): boolean {
    for (const run of this.runs.values()) {
      if (run.clarifications.answer(requestId, answer)) return true;
    }
    return false;
  }

  getPendingClarification(sessionId?: string): CanvasClarificationRequest | null {
    return this.runFor(sessionId)?.clarifications.latest() ?? null;
  }

  abortAll(): void {
    for (const run of this.runs.values()) run.abortController.abort();
  }
}
