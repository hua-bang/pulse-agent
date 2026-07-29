/**
 * Coalesces concurrent initialization requests by scope. Failed work is
 * removed from the gate as well, so a later request can retry normally.
 */
export class ScopeActivationGate {
  private pending = new Map<string, Promise<void>>();

  async run(scopeKey: string, initialize: () => Promise<void>): Promise<void> {
    const active = this.pending.get(scopeKey);
    if (active) {
      await active;
      return;
    }

    const next = initialize();
    this.pending.set(scopeKey, next);
    try {
      await next;
    } finally {
      if (this.pending.get(scopeKey) === next) {
        this.pending.delete(scopeKey);
      }
    }
  }
}
