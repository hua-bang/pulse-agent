import { describe, expect, it } from 'vitest';
import { findLoosenedGates } from './baseline-guard.mjs';

const policies = (gates) => ({
  profiles: { global: { appliesTo: {} } },
  policies: Object.fromEntries(Object.entries(gates).map(([id, gate]) => [id, { profile: 'global', gate }])),
});

describe('findLoosenedGates', () => {
  it('flags a raised ratchet baseline', () => {
    const base = policies({ 'bundle.entry_raw_kb': { kind: 'ratchet', baseline: 729, tolerancePct: 3 } });
    const head = policies({ 'bundle.entry_raw_kb': { kind: 'ratchet', baseline: 731, tolerancePct: 3 } });

    expect(findLoosenedGates(base, head)).toEqual([{
      id: 'bundle.entry_raw_kb',
      before: 'ratchet 729 +3% (limit 751) @ global',
      after: 'ratchet 731 +3% (limit 753) @ global',
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
    const head = policies({
      kind: { kind: 'min', value: 3 },
      max: { kind: 'max', value: 4 },
      min: { kind: 'min', value: 2 },
    });
    head.policies.removed = { profile: 'global' };

    expect(findLoosenedGates(base, head).map((gate) => gate.id))
      .toEqual(['removed', 'kind', 'max', 'min']);
  });

  it('flags a Gate moved to another profile or scope', () => {
    const gate = { kind: 'max', value: 80, scope: 'runtime' };
    const base = policies({ moved: gate, scoped: gate });
    const head = policies({ moved: gate, scoped: { ...gate, scope: 'bundle' } });
    head.profiles.local = { appliesTo: { os: 'darwin' } };
    head.policies.moved.profile = 'local';

    expect(findLoosenedGates(base, head).map((entry) => entry.id)).toEqual(['moved', 'scoped']);
  });

  it('flags a narrowed profile under an unchanged Gate', () => {
    const base = policies({ m: { kind: 'max', value: 3 } });
    const head = policies({ m: { kind: 'max', value: 3 } });
    head.profiles.global.appliesTo = { os: 'darwin' };

    expect(findLoosenedGates(base, head).map((entry) => entry.id)).toEqual(['m']);
  });

  it('accepts new Gates added in the PR', () => {
    expect(findLoosenedGates(policies({}), policies({ m: { kind: 'max', value: 1 } }))).toEqual([]);
  });
});
