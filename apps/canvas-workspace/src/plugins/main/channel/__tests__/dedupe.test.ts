import { afterEach, describe, it, expect, vi } from 'vitest';
import { MessageDedupe } from '../core/dedupe';
import type { PluginStore } from '../../../types';

function memoryStore(map = new Map<string, unknown>()): PluginStore {
  return {
    async get<T>(k: string) {
      return map.get(k) as T | undefined;
    },
    async set<T>(k: string, v: T) {
      map.set(k, v);
    },
    async delete(k: string) {
      map.delete(k);
    },
    async list() {
      return Array.from(map.keys());
    },
  };
}

describe('MessageDedupe', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts a new id once and rejects repeats', () => {
    const d = new MessageDedupe();
    expect(d.accept('m1')).toBe(true);
    expect(d.accept('m1')).toBe(false);
    expect(d.accept('m2')).toBe(true);
  });

  it('lets through empty ids (nothing to dedupe on)', () => {
    const d = new MessageDedupe();
    expect(d.accept('')).toBe(true);
    expect(d.accept('')).toBe(true);
  });

  it('evicts oldest entries beyond capacity (FIFO), allowing them to re-enter', () => {
    const d = new MessageDedupe(2);
    expect(d.accept('a')).toBe(true); // {a}
    expect(d.accept('b')).toBe(true); // {a,b}
    expect(d.accept('c')).toBe(true); // size 3 > 2 → evict oldest 'a' → {b,c}
    // 'a' was evicted, so it is treated as new again; adding it evicts 'b'.
    expect(d.accept('a')).toBe(true); // {c,a}
    // 'c' and 'a' are still tracked (dupes).
    expect(d.accept('c')).toBe(false);
    expect(d.accept('a')).toBe(false);
    // 'b' was evicted above, so it counts as new.
    expect(d.accept('b')).toBe(true);
  });

  it('persists accepted ids and recognizes them in a fresh instance', async () => {
    vi.useFakeTimers();
    const map = new Map<string, unknown>();

    const first = new MessageDedupe(500, { store: memoryStore(map), storeKey: 'dedupe' });
    await first.ensureLoaded();
    expect(first.accept('evt-1')).toBe(true);
    // Persistence is debounced — let the write flush.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(map.get('dedupe')).toEqual(['evt-1']);

    // A new instance (e.g. after an app restart) rehydrates from the store and
    // still recognizes the already-handled event.
    const second = new MessageDedupe(500, { store: memoryStore(map), storeKey: 'dedupe' });
    await second.ensureLoaded();
    expect(second.accept('evt-1')).toBe(false);
    expect(second.accept('evt-2')).toBe(true);
  });

  it('without a store, accept never throws and stays in-memory only', async () => {
    const d = new MessageDedupe(500);
    await d.ensureLoaded();
    expect(d.accept('x')).toBe(true);
    expect(d.accept('x')).toBe(false);
  });
});
