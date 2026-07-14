import { describe, expect, it } from 'vitest';
import { summarizeCoverage } from './coverage.mjs';

describe('performance metric coverage', () => {
  it('separates optional diagnostics from the core report contract', () => {
    const dictionary = {
      metrics: [
        { id: 'core.a' },
        { id: 'core.b' },
        { id: 'trace.a', coverageClass: 'diagnostic' },
      ],
    };
    const snapshot = {
      metrics: [
        { id: 'core.a', value: 1 },
        { id: 'core.b', value: false },
        { id: 'trace.a', value: 2 },
      ],
    };

    expect(summarizeCoverage(dictionary, snapshot)).toEqual({
      measured: 2,
      total: 2,
      diagnostic: { measured: 1, total: 1, status: 'complete' },
    });
  });

  it('does not count unknown, duplicate, or invalid values', () => {
    const dictionary = { metrics: [{ id: 'core.a' }, { id: 'trace.a', coverageClass: 'diagnostic' }] };
    const snapshot = {
      metrics: [
        { id: 'core.a', value: null },
        { id: 'core.a', value: Number.NaN },
        { id: 'unknown', value: 1 },
      ],
    };

    expect(summarizeCoverage(dictionary, snapshot)).toEqual({
      measured: 0,
      total: 1,
      diagnostic: { measured: 0, total: 1, status: 'unavailable' },
    });
  });

  it('does not require an unmeasured metric whose profile is unavailable on this runner', () => {
    const dictionary = {
      metrics: [
        { id: 'bundle.entry' },
        { id: 'package.dmg' },
        { id: 'timing.local' },
      ],
    };
    const snapshot = {
      metrics: [
        { id: 'bundle.entry', value: 619 },
        { id: 'timing.local', value: 42 },
      ],
    };
    const policiesById = {
      'bundle.entry': { applicable: true },
      'package.dmg': { applicable: false },
      'timing.local': { applicable: false },
    };

    expect(summarizeCoverage(dictionary, snapshot, policiesById)).toEqual({
      measured: 2,
      total: 2,
      diagnostic: { measured: 0, total: 0, status: 'not-configured' },
    });
  });

  it('still requires an applicable metric when its measurement is missing', () => {
    const dictionary = { metrics: [{ id: 'package.dmg' }] };

    expect(summarizeCoverage(dictionary, { metrics: [] }, {
      'package.dmg': { applicable: true },
    })).toEqual({
      measured: 0,
      total: 1,
      diagnostic: { measured: 0, total: 0, status: 'not-configured' },
    });
  });
});
