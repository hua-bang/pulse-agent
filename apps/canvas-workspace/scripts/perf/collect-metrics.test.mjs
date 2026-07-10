import { describe, expect, it } from 'vitest';
import { collectImageMemoryMetric, collectInteractionScenarioMetrics } from './collect-metrics.mjs';

describe('collectInteractionScenarioMetrics', () => {
  it('normalizes resize timing, counters, repeat samples, and gate results', () => {
    const scenarios = {
      scenarios: {
        resize: {
          report: {
            runs: 3,
            raw: {
              interactionsP95: [12, 14, 13],
              framesOver20Pct: [1, 2, 1.5],
              counters: [
                { 'nodes-array-replace': 1, 'canvas-save-ipc': 1 },
                { 'nodes-array-replace': 2, 'canvas-save-ipc': 1 },
                { 'nodes-array-replace': 2, 'canvas-save-ipc': 1 },
              ],
            },
            interactions: { p95: 13 },
            frames: { over20msPct: 1.5 },
            counters: { 'nodes-array-replace': 2, 'canvas-save-ipc': 1 },
          },
        },
      },
      gates: [
        { scenario: 'resize', counter: 'nodes-array-replace', max: 10, value: 2, pass: true },
        { scenario: 'resize', counter: 'canvas-save-ipc', max: 3, value: 1, pass: true },
      ],
    };

    expect(collectInteractionScenarioMetrics(scenarios, 'resize')).toEqual([
      { id: 'interact.resize.inp_p95_ms', value: 13, runs: 3, raw: [12, 14, 13] },
      { id: 'interact.resize.frames_over20_pct', value: 1.5, runs: 3, raw: [1, 2, 1.5] },
      {
        id: 'interact.resize.counter.nodes_array_replace', value: 2, runs: 3,
        raw: [1, 2, 2], pass: true, limit: 10,
      },
      {
        id: 'interact.resize.counter.canvas_save_ipc', value: 1, runs: 3,
        raw: [1, 1, 1], pass: true, limit: 3,
      },
    ]);
  });

  it('returns no entries when the selected scenario did not run', () => {
    expect(collectInteractionScenarioMetrics({ scenarios: {}, gates: [] }, 'resize')).toEqual([]);
    expect(collectInteractionScenarioMetrics(null, 'resize')).toEqual([]);
  });

  it('preserves a failed gate when its scenario or counter value is missing', () => {
    const scenarios = {
      scenarios: {},
      gates: [{
        scenario: 'resize',
        counter: 'canvas-save-ipc',
        max: 3,
        value: null,
        pass: false,
        missing: true,
      }],
    };

    expect(collectInteractionScenarioMetrics(scenarios, 'resize')).toEqual([{
      id: 'interact.resize.counter.canvas_save_ipc',
      value: null,
      runs: 1,
      pass: false,
      limit: 3,
      missing: true,
    }]);
  });
});

describe('collectMetrics image memory', () => {
  it('maps the image-memory scenario into the metric dictionary id', () => {
    expect(collectImageMemoryMetric({
      scenarios: {
        'image-memory': {
          images: 10,
          decodedMB: 26.4,
          originalDecodedMB: 457.8,
          reductionRatio: 17.4,
        },
      },
    })).toEqual({
      id: 'memory.image.decoded_mb',
      value: 26.4,
      runs: 1,
      detail: '10×4K · original 457.8 MB · 17.4× reduction',
    });
  });
});
