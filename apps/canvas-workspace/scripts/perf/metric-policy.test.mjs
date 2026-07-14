import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  applyMetricPolicies,
  buildP0TargetDetails,
  evaluatePolicyGate,
  isCompatibleHistorySnapshot,
  resolveMetricPolicy,
  validatePerformancePolicies,
} from './metric-policy.mjs';

const definition = {
  id: 'startup.dom_ready_ms',
  direction: 'lower',
  measurementProfile: 'local-darwin-arm64-n100-r3',
};

const baselines = {
  profiles: {
    'local-darwin-arm64-n100-r3': {
      appliesTo: {
        os: 'darwin',
        arch: 'arm64',
        seedNodes: 100,
        repeat: 3,
        fixtureVersion: 'perf-v1',
      },
    },
  },
  policies: {
    'startup.dom_ready_ms': {
      profile: 'local-darwin-arm64-n100-r3',
      target: 500,
      warning: 550,
      confidence: 'medium',
      basis: 'same-machine history',
      asOf: '2026-07-10',
    },
  },
};

const env = {
  os: 'darwin',
  arch: 'arm64',
  seedNodes: 100,
  repeat: 3,
  fixtureVersion: 'perf-v1',
};

describe('resolveMetricPolicy', () => {
  it.each([
    [498, 'met', 2],
    [525, 'near-warning', -25],
    [560, 'missed', -60],
  ])('classifies lower-is-better value %s as %s', (value, status, headroom) => {
    expect(resolveMetricPolicy({
      definition,
      entry: { id: definition.id, value },
      baselines,
      env,
    })).toMatchObject({
      profile: 'local-darwin-arm64-n100-r3',
      target: 500,
      warning: 550,
      applicable: true,
      status,
      headroom,
    });
  });

  it('supports higher-is-better targets and rejects cross-profile comparisons', () => {
    const higherDefinition = {
      id: 'chat.stream.md_cache_hit_ratio',
      direction: 'higher',
      measurementProfile: 'global-deterministic',
    };
    const higherBaselines = {
      profiles: {
        'global-deterministic': { appliesTo: {} },
      },
      policies: {
        [higherDefinition.id]: {
          profile: 'global-deterministic', target: 50, warning: 40,
          confidence: 'high', basis: 'deterministic fixture', asOf: '2026-07-10',
        },
      },
    };
    expect(resolveMetricPolicy({
      definition: higherDefinition,
      entry: { id: higherDefinition.id, value: 45 },
      baselines: higherBaselines,
      env,
    })).toMatchObject({ status: 'near-warning', headroom: -5, applicable: true });

    expect(resolveMetricPolicy({
      definition,
      entry: { id: definition.id, value: 498 },
      baselines,
      env: { ...env, repeat: 1 },
    })).toMatchObject({ status: 'not-applicable', headroom: null, applicable: false });
  });
});

describe('isCompatibleHistorySnapshot', () => {
  const current = {
    machineId: 'machine-a',
    env: {
      os: 'darwin', arch: 'arm64', seedNodes: 100, seedWebpages: 0,
      seedUrlWebviews: 0, repeat: 3, fixtureVersion: 'perf-v2',
      sessionProfile: 'temp', headless: false,
    },
  };

  it('requires the same machine and complete run profile', () => {
    expect(isCompatibleHistorySnapshot(current, structuredClone(current))).toBe(true);
    expect(isCompatibleHistorySnapshot(current, {
      ...structuredClone(current), env: { ...current.env, repeat: 1 },
    })).toBe(false);
    expect(isCompatibleHistorySnapshot(current, {
      ...structuredClone(current), machineId: 'machine-b',
    })).toBe(false);
    expect(isCompatibleHistorySnapshot(current, {
      ...structuredClone(current), env: { ...current.env, seedUrlWebviews: 1 },
    })).toBe(false);
    expect(isCompatibleHistorySnapshot(current, {
      ...structuredClone(current), env: { ...current.env, fixtureVersion: 'perf-v1' },
    })).toBe(false);
    expect(isCompatibleHistorySnapshot(current, {
      ...structuredClone(current), env: { ...current.env, sessionProfile: 'clone' },
    })).toBe(false);
    const legacyHtmlOnly = structuredClone(current);
    delete legacyHtmlOnly.env.seedUrlWebviews;
    expect(isCompatibleHistorySnapshot(current, legacyHtmlOnly)).toBe(true);
    expect(isCompatibleHistorySnapshot(current, {
      machineId: 'machine-a', env: { os: 'darwin', arch: 'arm64' },
    })).toBe(false);
  });
});

describe('evaluatePolicyGate', () => {
  it.each([
    [{ kind: 'max', value: 80 }, 64, true, 80],
    [{ kind: 'min', value: 50 }, 45, false, 50],
    [{ kind: 'exact', value: 0 }, 0, true, 0],
    [{ kind: 'true' }, true, true, true],
    [{ kind: 'ratchet', baseline: 1329, tolerancePct: 5 }, 1380, true, 1395],
  ])('evaluates %o against %s', (gate, value, pass, limit) => {
    expect(evaluatePolicyGate(gate, value)).toEqual({
      pass,
      limit,
      operator: gate.kind,
    });
  });
});

describe('validatePerformancePolicies', () => {
  it('keeps the repository dictionary and policy SSOT in sync', () => {
    const repositoryDictionary = JSON.parse(readFileSync(
      new URL('../../perf/metrics.json', import.meta.url),
      'utf-8',
    ));
    const repositoryBaselines = JSON.parse(readFileSync(
      new URL('../../perf/baselines.json', import.meta.url),
      'utf-8',
    ));

    expect(validatePerformancePolicies(repositoryDictionary, repositoryBaselines)).toEqual([]);
  });

  it('accepts a fully wired metric policy', () => {
    const gatedDictionary = {
      metrics: [{ ...definition, level: 'gate' }],
    };
    const configured = structuredClone(baselines);
    configured.policyVersion = 1;
    configured.policies[definition.id].gate = { kind: 'max', value: 600, scope: 'runtime' };

    expect(validatePerformancePolicies(gatedDictionary, configured)).toEqual([]);
  });

  it('fails closed for unknown metrics, profile drift, invalid ordering, and unwired gates', () => {
    const gatedDictionary = {
      metrics: [{ ...definition, level: 'gate' }],
    };
    const invalid = structuredClone(baselines);
    invalid.policyVersion = 1;
    invalid.policies[definition.id] = {
      ...invalid.policies[definition.id],
      profile: 'wrong-profile',
      target: 600,
      warning: 550,
    };
    invalid.policies.unknown = {
      profile: 'global', target: 1, warning: 2,
      confidence: 'high', basis: 'test', asOf: '2026-07-10',
    };

    expect(validatePerformancePolicies(gatedDictionary, invalid)).toEqual(expect.arrayContaining([
      expect.stringContaining('startup.dom_ready_ms: profile'),
      expect.stringContaining('startup.dom_ready_ms: lower target'),
      expect.stringContaining('startup.dom_ready_ms: level gate'),
      expect.stringContaining('unknown: unknown metric'),
    ]));
  });

  it('rejects missing scopes and directionally inverted Gates', () => {
    const id = 'chat.stream.md_cache_hit_ratio';
    const gatedDictionary = {
      metrics: [{
        id, level: 'gate', direction: 'higher', measurementProfile: 'global-deterministic',
      }],
    };
    const configured = {
      policyVersion: 1,
      profiles: { 'global-deterministic': { appliesTo: {} } },
      policies: {
        [id]: {
          profile: 'global-deterministic', target: 50, warning: 40,
          confidence: 'high', basis: 'test', asOf: '2026-07-10',
          gate: { kind: 'max', value: 50 },
        },
      },
    };

    expect(validatePerformancePolicies(gatedDictionary, configured)).toEqual(expect.arrayContaining([
      expect.stringContaining('gate scope must be bundle or runtime'),
      expect.stringContaining('max gate is incompatible with higher direction'),
    ]));

    configured.policies[id].gate = { kind: 'min', value: 50, scope: 'runtime' };
    gatedDictionary.metrics[0].level = 'warn';
    expect(validatePerformancePolicies(gatedDictionary, configured)).toContain(
      `${id}: policy gate requires level gate in metrics.json`,
    );
  });

  it('rejects a local profile whose applicability contract is missing', () => {
    const invalid = structuredClone(baselines);
    invalid.policyVersion = 1;
    invalid.profiles['local-darwin-arm64-n100-r3'] = {};

    expect(validatePerformancePolicies({ metrics: [definition] }, invalid)).toContain(
      'startup.dom_ready_ms: profile local-darwin-arm64-n100-r3 appliesTo must be an object',
    );
  });

  it('rejects restrictions on the global deterministic profile', () => {
    const id = 'bundle.entry_raw_kb';
    const invalid = {
      policyVersion: 1,
      profiles: { 'global-deterministic': { appliesTo: { os: 'linux' } } },
      policies: {
        [id]: {
          profile: 'global-deterministic', target: 1300, warning: 1350,
          confidence: 'high', basis: 'test', asOf: '2026-07-10',
          gate: { kind: 'max', value: 1400, scope: 'bundle' },
        },
      },
    };
    const gatedDictionary = {
      metrics: [{
        id, level: 'gate', direction: 'lower', measurementProfile: 'global-deterministic',
      }],
    };

    expect(validatePerformancePolicies(gatedDictionary, invalid)).toContain(
      `${id}: global-deterministic appliesTo must be empty`,
    );
  });
});

describe('applyMetricPolicies', () => {
  it('keeps a missed product target independent from a passing regression gate', () => {
    const id = 'bundle.entry_raw_kb';
    const policyDictionary = {
      metrics: [{
        id, level: 'gate', direction: 'lower', measurementProfile: 'global-deterministic',
      }],
    };
    const policyBaselines = {
      policyVersion: 1,
      profiles: { 'global-deterministic': { appliesTo: {} } },
      policies: {
        [id]: {
          profile: 'global-deterministic', target: 1300, warning: 1350,
          confidence: 'high', basis: 'bundle budget', asOf: '2026-07-10',
          gate: { kind: 'ratchet', baseline: 1329, tolerancePct: 5, scope: 'bundle' },
        },
      },
    };
    const original = { env: {}, metrics: [{ id, value: 1380 }] };

    const result = applyMetricPolicies(policyDictionary, policyBaselines, original);

    expect(result.snapshot.metrics[0]).toMatchObject({
      value: 1380,
      policy: { status: 'missed', target: 1300, headroom: -80 },
      pass: true,
      limit: 1395,
      gateOperator: 'ratchet',
    });
    expect(result.targetSummary).toMatchObject({ met: 0, nearWarning: 0, missed: 1 });
    expect(result.gateSummary).toMatchObject({ passed: 1, failed: 0, total: 1 });
    expect(original.metrics[0]).toEqual({ id, value: 1380 });
  });

  it('fails an applicable Gate closed when its metric is missing', () => {
    const id = 'chat.stream.md_cache_hit_ratio';
    const policyDictionary = {
      metrics: [{
        id, level: 'gate', direction: 'higher', measurementProfile: 'global-deterministic',
      }],
    };
    const policyBaselines = {
      policyVersion: 1,
      profiles: { 'global-deterministic': { appliesTo: {} } },
      policies: {
        [id]: {
          profile: 'global-deterministic', target: 50, warning: 40,
          confidence: 'high', basis: 'deterministic fixture', asOf: '2026-07-10',
          gate: { kind: 'min', value: 40, scope: 'runtime' },
        },
      },
    };

    const result = applyMetricPolicies(policyDictionary, policyBaselines, { env: {}, metrics: [] });

    expect(result.policiesById[id]).toMatchObject({ status: 'pending', gateStatus: 'unavailable' });
    expect(result.gateSummary).toMatchObject({ passed: 0, failed: 1, total: 1 });
    expect(result.snapshot.metrics).toEqual([]);

    const bundleOnly = applyMetricPolicies(
      policyDictionary,
      policyBaselines,
      { env: {}, metrics: [] },
      { gateScopes: ['bundle'] },
    );
    expect(bundleOnly.policiesById[id]).toMatchObject({ gateStatus: 'not-required' });
    expect(bundleOnly.gateSummary).toEqual({ passed: 0, failed: 0, total: 0 });

    const staleRuntimeEntry = applyMetricPolicies(
      policyDictionary,
      policyBaselines,
      { env: {}, metrics: [{ id, value: 50, pass: false, limit: 60 }] },
      { gateScopes: ['bundle'] },
    ).snapshot.metrics[0];
    expect(staleRuntimeEntry).not.toHaveProperty('pass');
    expect(staleRuntimeEntry).not.toHaveProperty('limit');
  });
});

describe('buildP0TargetDetails', () => {
  it('creates a machine-readable P0-only target contract', () => {
    const policy = {
      target: 50, warning: 80, status: 'near-warning', headroom: -10,
      confidence: 'medium', applicable: true,
    };
    expect(buildP0TargetDetails(
      {
        metrics: [
          { id: 'p0', aspect: 'interact', label: 'P0 latency', unit: 'ms', displayPriority: 'primary' },
          { id: 'p1', aspect: 'interact', label: 'P1 detail', unit: 'ms', displayPriority: 'supporting' },
        ],
      },
      { metrics: [{ id: 'p0', value: 60, policy }, { id: 'p1', value: 70, policy }] },
      { p0: policy, p1: policy },
    )).toEqual([{
      id: 'p0', aspect: 'interact', label: 'P0 latency', unit: 'ms', value: 60,
      target: 50, warning: 80, status: 'near-warning', headroom: -10,
      confidence: 'medium', applicable: true,
    }]);
  });
});
