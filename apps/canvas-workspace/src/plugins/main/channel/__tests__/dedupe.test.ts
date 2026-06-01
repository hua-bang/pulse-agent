import { describe, it, expect } from 'vitest';
import { MessageDedupe } from '../core/dedupe';

describe('MessageDedupe', () => {
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
});
