import { describe, expect, it } from 'vitest';
import { PtySessionLeaseRegistry } from './session-lease';

describe('PtySessionLeaseRegistry', () => {
  it('rejects a delayed release after the same session is reclaimed', () => {
    const registry = new PtySessionLeaseRegistry();
    const oldLease = registry.claim('session-1');
    const newLease = registry.claim('session-1');

    expect(registry.release('session-1', oldLease)).toBe(false);
    expect(registry.release('session-1', newLease)).toBe(true);
  });

  it('keeps an unscoped explicit kill backward compatible', () => {
    const registry = new PtySessionLeaseRegistry();
    registry.claim('session-1');

    expect(registry.release('session-1')).toBe(true);
  });
});
