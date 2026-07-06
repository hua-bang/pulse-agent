import { beforeEach, describe, expect, it } from 'vitest';
import {
  count,
  countersEnabled,
  resetCounters,
  setCountersEnabled,
  snapshotCounters,
} from '../counters';

describe('perf counters', () => {
  beforeEach(() => {
    setCountersEnabled(false);
    resetCounters();
  });

  it('is a no-op while disabled (default)', () => {
    expect(countersEnabled()).toBe(false);
    count('nodes-array-replace');
    expect(snapshotCounters()).toEqual({});
  });

  it('accumulates while enabled and supports custom increments', () => {
    setCountersEnabled(true);
    count('nodes-array-replace');
    count('nodes-array-replace');
    count('canvas-save-ipc', 3);
    expect(snapshotCounters()).toEqual({
      'nodes-array-replace': 2,
      'canvas-save-ipc': 3,
    });
  });

  it('reset clears all counters', () => {
    setCountersEnabled(true);
    count('terminal-fit');
    resetCounters();
    expect(snapshotCounters()).toEqual({});
  });
});
