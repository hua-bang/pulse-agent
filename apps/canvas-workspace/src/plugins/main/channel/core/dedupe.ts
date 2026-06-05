import type { PluginStore } from '../../../types';

const PERSIST_DEBOUNCE_MS = 1_000;

/**
 * Bounded LRU set for idempotent message dedupe. Channels can redeliver the
 * same event (retries, reconnects); we drop any message whose id we have
 * already accepted. Capacity-bounded so memory stays flat over a long run.
 *
 * Optionally backed by a {@link PluginStore} so the seen-set survives an app
 * restart — without it, a redelivery that straddles a relaunch (Feishu retries
 * an event the bot already handled) would be processed twice. Persistence is
 * best-effort and debounced; an accept is never blocked on the write.
 */
export class MessageDedupe {
  private readonly seen = new Set<string>();
  private readonly capacity: number;
  private readonly store?: PluginStore;
  private readonly storeKey: string;
  private loaded: boolean;
  private saveTimer: NodeJS.Timeout | null = null;
  private dirty = false;

  constructor(
    capacity = 500,
    options: { store?: PluginStore; storeKey?: string } = {},
  ) {
    this.capacity = Math.max(1, capacity);
    this.store = options.store;
    this.storeKey = options.storeKey ?? 'dedupe';
    // With no store there is nothing to load; treat as ready immediately.
    this.loaded = !this.store;
  }

  /**
   * Hydrate the seen-set from the store once. No-op when unbacked. Call (and
   * await) before the first {@link accept} so a redelivered id from before a
   * restart is recognized.
   */
  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true; // set first so concurrent callers don't double-load
    try {
      const saved = await this.store!.get<string[]>(this.storeKey);
      if (Array.isArray(saved)) {
        // Keep insertion order and trim to capacity (newest ids retained).
        for (const id of saved.slice(-this.capacity)) {
          if (typeof id === 'string' && id) this.seen.add(id);
        }
      }
    } catch {
      /* best-effort — an empty/corrupt store just means no cross-restart dedupe */
    }
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
    this.schedulePersist();
    return true;
  }

  private schedulePersist(): void {
    if (!this.store) return;
    this.dirty = true;
    if (this.saveTimer) return;
    // Debounce so a burst of inbound events persists with a single write.
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flush();
    }, PERSIST_DEBOUNCE_MS);
    // A pending dedupe flush should never hold the process open.
    this.saveTimer.unref?.();
  }

  private async flush(): Promise<void> {
    if (!this.store || !this.dirty) return;
    this.dirty = false;
    try {
      await this.store.set(this.storeKey, Array.from(this.seen));
    } catch {
      this.dirty = true; // leave dirty so the next accept retries the write
    }
  }
}
