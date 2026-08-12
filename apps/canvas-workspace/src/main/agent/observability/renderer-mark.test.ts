import { describe, expect, it } from 'vitest';

import { isAgentObservabilityMark } from './renderer-mark';

describe('renderer observability mark validation', () => {
  it('accepts only the two renderer-owned milestones', () => {
    expect(isAgentObservabilityMark({
      runId: 'run-1', milestone: 'ui.request-dispatched', timestamp: 12,
    })).toBe(true);
    expect(isAgentObservabilityMark({
      runId: 'run-1', milestone: 'ui.first-content-rendered', timestamp: 18,
    })).toBe(true);
    expect(isAgentObservabilityMark({
      runId: 'run-1', milestone: 'runtime.first-text', timestamp: 18,
    })).toBe(false);
  });

  it('rejects malformed ids and timestamps', () => {
    expect(isAgentObservabilityMark({
      runId: '', milestone: 'ui.request-dispatched', timestamp: 12,
    })).toBe(false);
    expect(isAgentObservabilityMark({
      runId: 'run-1', milestone: 'ui.request-dispatched', timestamp: Number.NaN,
    })).toBe(false);
  });
});
