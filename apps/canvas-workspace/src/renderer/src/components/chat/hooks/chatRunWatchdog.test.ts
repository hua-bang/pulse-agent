import { describe, expect, it, vi } from 'vitest';

import { startChatRunWatchdog } from './chatRunWatchdog';

describe('chat run watchdog', () => {
  it('restores persisted history when completion was lost', async () => {
    vi.useFakeTimers();
    const onRecovered = vi.fn();
    const recoverHistory = vi.fn(async () => ({
      ok: true,
      messages: [{ role: 'assistant' as const, content: 'recovered', timestamp: 1 }],
    }));
    const cancel = startChatRunWatchdog({
      pollMs: 10,
      getRunStatus: vi.fn(async () => ({ ok: true, active: false })),
      recoverHistory,
      onRecovered,
      onRecoveryFailed: vi.fn(),
    });

    await vi.advanceTimersByTimeAsync(10);

    expect(recoverHistory).toHaveBeenCalledTimes(1);
    expect(onRecovered).toHaveBeenCalledWith([
      { role: 'assistant', content: 'recovered', timestamp: 1 },
    ]);
    cancel();
    vi.useRealTimers();
  });

  it('stops polling after cancellation', async () => {
    vi.useFakeTimers();
    const getRunStatus = vi.fn(async () => ({ ok: true, active: true }));
    const cancel = startChatRunWatchdog({
      pollMs: 10,
      getRunStatus,
      recoverHistory: vi.fn(),
      onRecovered: vi.fn(),
      onRecoveryFailed: vi.fn(),
    });
    cancel();

    await vi.advanceTimersByTimeAsync(30);

    expect(getRunStatus).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
