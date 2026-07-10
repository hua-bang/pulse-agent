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
});
