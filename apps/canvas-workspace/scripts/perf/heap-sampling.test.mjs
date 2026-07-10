import { describe, expect, it, vi } from 'vitest';
import { sampleRetainedHeapMB } from './heap-sampling.mjs';

describe('retained heap sampling', () => {
  it('fails when forced GC cannot be confirmed', async () => {
    const cdp = {
      send: vi.fn().mockRejectedValueOnce(new Error('GC unsupported')),
    };

    await expect(sampleRetainedHeapMB(cdp, { settleMs: 0 }))
      .rejects.toThrow('CDP heap GC failed');
  });

  it('fails when heap usage is missing instead of returning zero', async () => {
    const cdp = {
      send: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ usedSize: 0 }),
    };

    await expect(sampleRetainedHeapMB(cdp, { settleMs: 0 }))
      .rejects.toThrow('invalid usedSize');
  });

  it('returns the retained heap in rounded MiB after two GC passes', async () => {
    const cdp = {
      send: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ usedSize: 10.04 * 1024 * 1024 }),
    };

    await expect(sampleRetainedHeapMB(cdp, { settleMs: 0 })).resolves.toBe(10);
    expect(cdp.send.mock.calls.map(([method]) => method)).toEqual([
      'HeapProfiler.collectGarbage',
      'HeapProfiler.collectGarbage',
      'Runtime.getHeapUsage',
    ]);
  });
});
