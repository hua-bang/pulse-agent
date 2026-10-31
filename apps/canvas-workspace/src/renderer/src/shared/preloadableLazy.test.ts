// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { preloadWhenIdle } from './preloadableLazy';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestIdleCallback', (callback: () => void) => window.setTimeout(callback, 0));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('preloadWhenIdle', () => {
  it('waits past the first screen before it loads the chunks', () => {
    const load = vi.fn(() => Promise.resolve());

    preloadWhenIdle([load]);
    vi.advanceTimersByTime(1499);
    expect(load).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    vi.runOnlyPendingTimers();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
