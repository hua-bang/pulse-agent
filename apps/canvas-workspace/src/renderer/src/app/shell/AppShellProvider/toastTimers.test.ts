import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_VISIBLE_TOASTS, ToastTimers, visibleToasts } from './toastTimers';

const toast = (id: string, autoCloseMs = 1000) => ({ id, autoCloseMs });

describe('ToastTimers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows only the newest toasts', () => {
    const all = Array.from({ length: MAX_VISIBLE_TOASTS + 2 }, (_, index) => toast(`t${index}`));
    expect(visibleToasts(all).map((item) => item.id)).toEqual(['t2', 't3', 't4', 't5']);
  });

  it('does not run the timer of a queued toast until it is visible', () => {
    const expired: string[] = [];
    const timers = new ToastTimers((id) => expired.push(id));
    const queued = toast('queued', 1000);
    const newer = ['a', 'b', 'c', 'd'].map((id) => toast(id, 5000));

    timers.sync(visibleToasts([queued, ...newer]));
    vi.advanceTimersByTime(3000);
    expect(expired).toEqual([]);

    // One newer toast leaves, so the queued one shows with its full time.
    timers.sync(visibleToasts([queued, ...newer.slice(1)]));
    vi.advanceTimersByTime(999);
    expect(expired).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(expired).toEqual(['queued']);
  });

  it('keeps the remaining time when a visible toast is pushed back into the queue', () => {
    const expired: string[] = [];
    const timers = new ToastTimers((id) => expired.push(id));
    const first = toast('first', 1000);

    timers.sync([first]);
    vi.advanceTimersByTime(600);
    timers.sync([]);
    vi.advanceTimersByTime(5000);
    expect(expired).toEqual([]);

    timers.sync([first]);
    vi.advanceTimersByTime(399);
    expect(expired).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(expired).toEqual(['first']);
  });

  it('pauses on hover and resumes with the remaining time', () => {
    const expired: string[] = [];
    const timers = new ToastTimers((id) => expired.push(id));

    timers.sync([toast('hover', 1000)]);
    vi.advanceTimersByTime(700);
    timers.pause('hover');
    vi.advanceTimersByTime(10_000);
    expect(expired).toEqual([]);

    timers.resume('hover');
    vi.advanceTimersByTime(300);
    expect(expired).toEqual(['hover']);
  });

  it('never schedules a toast without a duration', () => {
    const expired: string[] = [];
    const timers = new ToastTimers((id) => expired.push(id));

    timers.sync([toast('loading', 0)]);
    vi.advanceTimersByTime(60_000);
    expect(expired).toEqual([]);
  });

  it('restarts the full duration after reset', () => {
    const expired: string[] = [];
    const timers = new ToastTimers((id) => expired.push(id));

    timers.sync([toast('updated', 1000)]);
    vi.advanceTimersByTime(900);
    timers.reset('updated');
    timers.sync([toast('updated', 2000)]);
    vi.advanceTimersByTime(1999);
    expect(expired).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(expired).toEqual(['updated']);
  });
});
