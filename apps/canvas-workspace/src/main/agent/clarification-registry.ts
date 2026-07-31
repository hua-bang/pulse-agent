import type { AgentClarificationRequest } from '../../shared/agent-chat';

export type PendingClarificationRequest = AgentClarificationRequest;

type PendingEntry = {
  settle: (answer: string) => void;
  fallback: string;
  request: PendingClarificationRequest;
  activate: () => void;
};

/**
 * Owns the main-process lifetime of renderer-backed clarification requests.
 * A timeout or abort resolves with the request's default, falling back to
 * "No" so approval callers fail closed.
 */
export class ClarificationRegistry {
  private readonly entries = new Map<string, PendingEntry>();
  private readonly queue: string[] = [];
  private cancelling = false;

  wait(
    request: PendingClarificationRequest,
    notify: (request: PendingClarificationRequest) => void,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    const existing = this.entries.get(request.id);
    existing?.settle(existing.fallback);

    return new Promise<string>((resolve) => {
      const fallback = request.defaultAnswer ?? 'No';
      let timer: ReturnType<typeof setTimeout> | undefined;
      let active = false;
      const onAbort = () => settle(fallback);
      const settle = (answer: string) => {
        if (this.entries.get(request.id)?.settle !== settle) return;
        this.entries.delete(request.id);
        const index = this.queue.indexOf(request.id);
        if (index >= 0) this.queue.splice(index, 1);
        if (timer) clearTimeout(timer);
        abortSignal?.removeEventListener('abort', onAbort);
        resolve(answer);
        if (active && !this.cancelling) this.activateNext();
      };
      const activate = () => {
        if (active || !this.entries.has(request.id)) return;
        active = true;
        if (request.timeout && Number.isFinite(request.timeout) && request.timeout > 0) {
          timer = setTimeout(() => settle(fallback), request.timeout);
        }
        try {
          notify(request);
        } catch {
          settle(fallback);
        }
      };

      this.entries.set(request.id, {
        settle,
        fallback,
        request: { ...request },
        activate,
      });
      this.queue.push(request.id);
      if (abortSignal?.aborted) {
        settle(fallback);
        return;
      }
      abortSignal?.addEventListener('abort', onAbort, { once: true });
      this.activateNext();
    });
  }

  answer(requestId: string, answer: string): boolean {
    const entry = this.entries.get(requestId);
    if (!entry) return false;
    entry.settle(answer);
    return true;
  }

  latest(): PendingClarificationRequest | null {
    const entry = this.queue.length > 0 ? this.entries.get(this.queue[0]) : undefined;
    return entry ? { ...entry.request } : null;
  }

  cancelAll(): void {
    this.cancelling = true;
    for (const entry of [...this.entries.values()]) entry.settle(entry.fallback);
    this.cancelling = false;
  }

  private activateNext(): void {
    const entry = this.queue.length > 0 ? this.entries.get(this.queue[0]) : undefined;
    entry?.activate();
  }
}
