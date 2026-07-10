import { describe, expect, it } from 'vitest';
import { aggregateReports } from './scenario-metrics.mjs';

const report = ({
  interactionP95,
  framesPct,
  framesCount,
  wheelP95,
  wheelMax,
  counter,
}) => ({
  scenario: 'panzoom',
  counters: { probe: counter },
  interactions: { count: 1, p75: interactionP95, p95: interactionP95, max: interactionP95 },
  frames: {
    count: 100,
    over20msCount: framesCount,
    over20msPct: framesPct,
    p95DeltaMs: 10,
  },
  wheelToNextFrame: { count: 50, p95: wheelP95, max: wheelMax },
});

describe('aggregateReports', () => {
  it('keeps repeat medians, worst frame values, and every requested raw signal', () => {
    const aggregated = aggregateReports([
      report({ interactionP95: 8, framesPct: 0, framesCount: 0, wheelP95: 9, wheelMax: 15, counter: 2 }),
      report({ interactionP95: 12, framesPct: 0.2, framesCount: 1, wheelP95: 13, wheelMax: 19, counter: 3 }),
      report({ interactionP95: 10, framesPct: 0.4, framesCount: 2, wheelP95: 11, wheelMax: 17, counter: 1 }),
    ]);

    expect(aggregated.interactions.p95).toBe(10);
    expect(aggregated.frames).toMatchObject({
      over20msPct: 0.2,
      over20msPctMax: 0.4,
      over20msCountMax: 2,
    });
    expect(aggregated.wheelToNextFrame).toEqual({ count: 50, p95: 11, max: 19 });
    expect(aggregated.counters.probe).toBe(3);
    expect(aggregated.raw).toEqual({
      interactionsP95: [8, 12, 10],
      framesOver20Pct: [0, 0.2, 0.4],
      framesOver20Count: [0, 1, 2],
      wheelToNextFrameP95: [9, 13, 11],
      counters: [{ probe: 2 }, { probe: 3 }, { probe: 1 }],
    });
  });

  it('leaves a single report unchanged for compatibility', () => {
    const single = report({
      interactionP95: 7,
      framesPct: 0,
      framesCount: 0,
      wheelP95: 8,
      wheelMax: 9,
      counter: 1,
    });

    expect(aggregateReports([single])).toBe(single);
  });

  it('does not invent wheel raw data for scenarios without the probe', () => {
    const first = report({
      interactionP95: 7,
      framesPct: 0,
      framesCount: 0,
      wheelP95: 8,
      wheelMax: 9,
      counter: 1,
    });
    const second = structuredClone(first);
    delete first.wheelToNextFrame;
    delete second.wheelToNextFrame;

    const aggregated = aggregateReports([first, second]);

    expect(aggregated).not.toHaveProperty('wheelToNextFrame');
    expect(aggregated.raw).not.toHaveProperty('wheelToNextFrameP95');
  });
});
