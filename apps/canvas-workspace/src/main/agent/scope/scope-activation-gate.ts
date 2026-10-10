/**
 * Coalesces concurrent initialization requests by scope. Failed work is
 * removed from the gate as well, so a later request can retry normally.
 * Every caller, including one that joined in-flight work, receives the same
 * result.
 */
export class ScopeActivationGate {
  private pending = new Map<string, Promise<unknown>>();

  isPending(scopeKey: string): boolean {
    return this.pending.has(scopeKey);
  }

  async run<T = void>(scopeKey: string, initialize: () => Promise<T>): Promise<T> {
    const active = this.pending.get(scopeKey);
    if (active) return await active as T;

    const next = initialize();
    this.pending.set(scopeKey, next);
    try {
      return await next;
    } finally {
      if (this.pending.get(scopeKey) === next) {
        this.pending.delete(scopeKey);
      }
    }
  }
}
