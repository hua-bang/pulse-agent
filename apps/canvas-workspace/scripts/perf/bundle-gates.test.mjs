import { describe, expect, it } from 'vitest';
import { buildBundleGates } from './bundle-gates.mjs';

describe('buildBundleGates', () => {
  it('reads ratchet numbers from metric policies', () => {
    const baselines = {
      policies: {
        'bundle.entry_raw_kb': {
          gate: { kind: 'ratchet', baseline: 1329, tolerancePct: 5, scope: 'bundle' },
        },
      },
    };

    expect(buildBundleGates(baselines, { entryRawKB: 1380 })).toEqual([{
      metric: 'entryRawKB',
      metricId: 'bundle.entry_raw_kb',
      baseline: 1329,
      tolerancePct: 5,
      limit: 1395,
      current: 1380,
      deltaPct: 3.8,
      pass: true,
    }]);
  });

  it('keeps the legacy bundle shape as a compatibility fallback', () => {
    expect(buildBundleGates({
      bundle: { entryRawKB: { baseline: 100, tolerancePct: 5 } },
    }, { entryRawKB: 106 })).toEqual([{
      metric: 'entryRawKB',
      metricId: 'bundle.entry_raw_kb',
      baseline: 100,
      tolerancePct: 5,
      limit: 105,
      current: 106,
      deltaPct: 6,
      pass: false,
    }]);
  });

  it('enforces the built-output lazy-boundary policy in perf:bundle', () => {
    const baselines = {
      policies: {
        'bundle.lazy_boundary_watchlist': {
          gate: { kind: 'true', scope: 'bundle' },
        },
      },
    };

    expect(buildBundleGates(baselines, { lazyBoundaryWatchlist: false })).toEqual([{
      metric: 'lazyBoundaryWatchlist',
      metricId: 'bundle.lazy_boundary_watchlist',
      kind: 'true',
      baseline: null,
      tolerancePct: null,
      limit: true,
      current: false,
      deltaPct: null,
      pass: false,
    }]);
  });
});
