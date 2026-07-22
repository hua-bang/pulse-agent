import { afterEach, describe, expect, it, vi } from 'vitest';
import { InitialWebviewLoadScheduler } from './initial-load-scheduler';

afterEach(() => {
  vi.useRealTimers();
});

describe('InitialWebviewLoadScheduler', () => {
  it('admits at most the configured number and drains a mount batch by priority', async () => {
    const granted: string[] = [];
    const scheduler = new InitialWebviewLoadScheduler({ limit: 2 });

    scheduler.schedule('dom-first-far', 100, () => granted.push('dom-first-far'));
    scheduler.schedule('active-dock', 0, () => granted.push('active-dock'));
    scheduler.schedule('viewport-center', 10, () => granted.push('viewport-center'));
    scheduler.schedule('last-far', 100, () => granted.push('last-far'));
    await Promise.resolve();

    expect(granted).toEqual(['active-dock', 'viewport-center']);
    expect(scheduler.snapshot()).toMatchObject({
      active: ['active-dock', 'viewport-center'],
      queued: [
        { id: 'dom-first-far', priority: 100 },
        { id: 'last-far', priority: 100 },
      ],
    });

    scheduler.release('active-dock', 'complete');
    await Promise.resolve();
    expect(granted).toEqual(['active-dock', 'viewport-center', 'dom-first-far']);
  });

  it('supports an explicit diagnostic timeout', async () => {
    vi.useFakeTimers();
    const granted: string[] = [];
    const scheduler = new InitialWebviewLoadScheduler({ limit: 1, timeoutMs: 5_000 });
    scheduler.schedule('wedged', 0, () => granted.push('wedged'));
    scheduler.schedule('waiting', 1, () => granted.push('waiting'));
    await Promise.resolve();

    vi.advanceTimersByTime(5_000);
    await Promise.resolve();

    expect(granted).toEqual(['wedged', 'waiting']);
  });

  it('does not release a production slot on elapsed wall time alone', async () => {
    vi.useFakeTimers();
    const granted: string[] = [];
    const scheduler = new InitialWebviewLoadScheduler({ limit: 1 });
    scheduler.schedule('slow-background', 1_000, () => granted.push('slow-background'));
    scheduler.schedule('waiting-background', 1_001, () => granted.push('waiting-background'));
    await Promise.resolve();

    vi.advanceTimersByTime(60_000);
    await Promise.resolve();

    expect(granted).toEqual(['slow-background']);
  });

  it('allows one foreground request past saturated background slots', async () => {
    const granted: string[] = [];
    const scheduler = new InitialWebviewLoadScheduler({ limit: 2 });
    scheduler.schedule('background-1', 1_000, () => granted.push('background-1'));
    scheduler.schedule('background-2', 1_001, () => granted.push('background-2'));
    await Promise.resolve();

    scheduler.schedule('active-dock', 0, () => granted.push('active-dock'));
    scheduler.schedule('another-active', 1, () => granted.push('another-active'));
    await Promise.resolve();

    expect(granted).toEqual(['background-1', 'background-2', 'active-dock']);
    expect(scheduler.snapshot().queued).toEqual([
      { id: 'another-active', priority: 1 },
    ]);
  });

  it('moves the foreground escape hatch when the active Dock tab changes', async () => {
    const granted: string[] = [];
    const scheduler = new InitialWebviewLoadScheduler({ limit: 1 });
    const previous = scheduler.schedule('previous-active', 0, () => granted.push('previous-active'));
    await Promise.resolve();

    previous.updatePriority(500);
    scheduler.schedule('next-active', 0, () => granted.push('next-active'));
    await Promise.resolve();

    expect(granted).toEqual(['previous-active', 'next-active']);
  });

  it('cancellation releases an active slot and unlimited mode admits all requests', async () => {
    const granted: string[] = [];
    const scheduler = new InitialWebviewLoadScheduler({ limit: 1 });
    const first = scheduler.schedule('first', 0, () => granted.push('first'));
    scheduler.schedule('second', 1, () => granted.push('second'));
    await Promise.resolve();
    first.cancel();
    await Promise.resolve();
    expect(granted).toEqual(['first', 'second']);

    scheduler.configure(0);
    scheduler.schedule('third', 2, () => granted.push('third'));
    scheduler.schedule('fourth', 3, () => granted.push('fourth'));
    await Promise.resolve();
    expect(granted).toEqual(['first', 'second', 'third', 'fourth']);
    expect(scheduler.snapshot().limit).toBe(0);
  });
});
