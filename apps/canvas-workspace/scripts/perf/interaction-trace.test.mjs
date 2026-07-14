import { describe, expect, it } from 'vitest';
import { summarizeInteractionTrace } from './interaction-trace.mjs';

describe('interaction trace summary', () => {
  it('aggregates only complete tracked events and converts microseconds to milliseconds', () => {
    const summary = summarizeInteractionTrace({
      traceEvents: [
        { name: 'GPUTask', ph: 'X', dur: 12_500 },
        { name: 'GPUTask', ph: 'X', dur: 7_000 },
        { name: 'RasterTask', ph: 'X', dur: 1_250 },
        { name: 'Paint', ph: 'B', ts: 10 },
        { name: 'untracked', ph: 'X', dur: 999_000 },
      ],
    });

    expect(summary).toMatchObject({
      traceEventCount: 5,
      trackedEventCount: 3,
      byName: {
        GPUTask: { count: 2, totalMs: 19.5, maxMs: 12.5 },
        RasterTask: { count: 1, totalMs: 1.3, maxMs: 1.3 },
        Paint: { count: 0, totalMs: 0, maxMs: 0 },
      },
    });
  });

  it('returns a stable zero-filled schema when trace events are unavailable', () => {
    const summary = summarizeInteractionTrace(null);

    expect(summary.traceEventCount).toBe(0);
    expect(summary.trackedEventCount).toBe(0);
    expect(summary.byName.UpdateLayoutTree).toEqual({ count: 0, totalMs: 0, maxMs: 0 });
  });
});
