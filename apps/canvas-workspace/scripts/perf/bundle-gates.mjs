import { evaluatePolicyGate } from './metric-policy.mjs';

const BUNDLE_METRICS = [
  ['entryRawKB', 'bundle.entry_raw_kb', 'ratchet'],
  ['entryGzipKB', 'bundle.entry_gzip_kb', 'ratchet'],
  ['totalJsKB', 'bundle.total_js_kb', 'ratchet'],
  ['lazyBoundaryWatchlist', 'bundle.lazy_boundary_watchlist', 'true'],
];

export const buildBundleGates = (baselines, current) => BUNDLE_METRICS.flatMap(
  ([metric, metricId, expectedKind]) => {
    const policyGate = baselines?.policies?.[metricId]?.gate;
    const legacy = baselines?.bundle?.[metric];
    if (policyGate && policyGate.kind !== expectedKind) {
      throw new Error(`${metricId}: bundle Gate must use ${expectedKind}`);
    }
    const gate = policyGate ?? (legacy ? { kind: 'ratchet', ...legacy } : null);
    if (!gate) return [];
    const evaluation = evaluatePolicyGate(gate, current[metric]);
    if (gate.kind === 'true') {
      return [{
        metric,
        metricId,
        kind: gate.kind,
        baseline: null,
        tolerancePct: null,
        limit: evaluation.limit,
        current: current[metric],
        deltaPct: null,
        pass: evaluation.pass,
      }];
    }
    return [{
      metric,
      metricId,
      baseline: gate.baseline,
      tolerancePct: gate.tolerancePct,
      limit: evaluation.limit,
      current: current[metric],
      deltaPct: Math.round(((current[metric] - gate.baseline) / gate.baseline) * 1000) / 10,
      pass: evaluation.pass,
    }];
  },
);
