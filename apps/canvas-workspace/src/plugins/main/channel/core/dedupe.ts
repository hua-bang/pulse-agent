/**
 * Bounded LRU set for idempotent message dedupe. Channels can redeliver the
 * same event (retries, reconnects); we drop any message whose id we have
 * already accepted. Capacity-bounded so memory stays flat over a long run.
 */
export class MessageDedupe {
  private readonly seen = new Set<string>();
  private readonly capacity: number;

  constructor(capacity = 500) {
    this.capacity = Math.max(1, capacity);
  }

  /**
   * Record `id` as seen. Returns true if it is new (caller should process),
   * false if it was already seen (caller should drop).
   */
  accept(id: string): boolean {
    if (!id) return true; // No id to dedupe on — let it through.
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    if (this.seen.size > this.capacity) {
      // Sets preserve insertion order; evict the oldest entry.
      const oldest = this.seen.values().next().value as string | undefined;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    return true;
  }
}
