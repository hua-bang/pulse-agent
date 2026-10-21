import { describe, expect, it } from 'vitest';
import { findLoosenedGates } from './baseline-guard.mjs';

const policies = (gates) => ({
  policies: Object.fromEntries(Object.entries(gates).map(([id, gate]) => [id, { gate }])),
});

describe('findLoosenedGates', () => {
  it('flags a raised ratchet baseline', () => {
    const base = policies({ 'bundle.entry_raw_kb': { kind: 'ratchet', baseline: 729, tolerancePct: 3 } });
    const head = policies({ 'bundle.entry_raw_kb': { kind: 'ratchet', baseline: 731, tolerancePct: 3 } });

    expect(findLoosenedGates(base, head)).toEqual([{
      id: 'bundle.entry_raw_kb',
      before: 'ratchet 729 +3% (limit 751)',
      after: 'ratchet 731 +3% (limit 753)',
    }]);
  });

  it('flags a raised ratchet tolerance', () => {
    const base = policies({ m: { kind: 'ratchet', baseline: 700, tolerancePct: 3 } });
    const head = policies({ m: { kind: 'ratchet', baseline: 700, tolerancePct: 5 } });

    expect(findLoosenedGates(base, head).map((gate) => gate.id)).toEqual(['m']);
  });

  it('allows a lowered or unchanged Gate', () => {
    const base = policies({
      a: { kind: 'ratchet', baseline: 731, tolerancePct: 3 },
      b: { kind: 'max', value: 10 },
      c: { kind: 'min', value: 5 },
      d: { kind: 'true' },
    });
    const head = policies({
      a: { kind: 'ratchet', baseline: 720, tolerancePct: 3 },
      b: { kind: 'max', value: 8 },
      c: { kind: 'min', value: 6 },
      d: { kind: 'true' },
    });

    expect(findLoosenedGates(base, head)).toEqual([]);
  });

  it('ignores a raise that rounds to the same limit', () => {
    const base = policies({ m: { kind: 'ratchet', baseline: 100, tolerancePct: 3 } });
    const head = policies({ m: { kind: 'ratchet', baseline: 100.2, tolerancePct: 3 } });

    expect(findLoosenedGates(base, head)).toEqual([]);
  });

  it('flags removed Gates, kind changes, and looser max/min values', () => {
    const base = policies({
      removed: { kind: 'max', value: 3 },
      kind: { kind: 'max', value: 3 },
      max: { kind: 'max', value: 3 },
      min: { kind: 'min', value: 3 },
    });
    const head = {
      policies: {
        removed: {},
        kind: { gate: { kind: 'min', value: 3 } },
        max: { gate: { kind: 'max', value: 4 } },
        min: { gate: { kind: 'min', value: 2 } },
      },
    };

    expect(findLoosenedGates(base, head).map((gate) => gate.id))
      .toEqual(['removed', 'kind', 'max', 'min']);
  });

  it('accepts new Gates added in the PR', () => {
    expect(findLoosenedGates(policies({}), policies({ m: { kind: 'max', value: 1 } }))).toEqual([]);
  });
});
