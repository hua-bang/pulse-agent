import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Guards the completion signal for a scheduled run. The failure path used to
 * announce nothing (the throw happened before the notification), and the
 * notification object was dropped straight after `show()`, which lets
 * Electron collect it before the OS displays it.
 */
const h = vi.hoisted(() => ({
  sent: [] as Array<{ channel: string; payload: unknown }>,
  notifications: [] as Array<{
    options: { title: string; body: string };
    shown: boolean;
    handlers: Map<string, () => void>;
  }>,
  chatResult: { ok: true } as { ok: boolean; error?: string },
  chatThrows: null as Error | null,
}));

vi.mock('electron', () => {
  class FakeNotification {
    static isSupported = () => true;
    shown = false;
    handlers = new Map<string, () => void>();
    constructor(public options: { title: string; body: string }) {
      h.notifications.push(this as never);
    }
    on(event: string, handler: () => void) {
      this.handlers.set(event, handler);
      return this;
    }
    show() {
      this.shown = true;
    }
  }
  return {
    Notification: FakeNotification,
    BrowserWindow: {
      getAllWindows: () => [
        {
          isDestroyed: () => false,
          isMinimized: () => false,
          restore: () => undefined,
          show: () => undefined,
          focus: () => undefined,
          webContents: {
            send: (channel: string, payload: unknown) => { h.sent.push({ channel, payload }); },
          },
        },
      ],
    },
  };
});

vi.mock('../agent/ipc', () => ({
  getCanvasAgentService: () => ({
    chatWithScope: async () => {
      if (h.chatThrows) throw h.chatThrows;
      return h.chatResult;
    },
    resolveCurrentSessionId: async () => 'session-1',
  }),
}));

import { __testing } from '../scheduled/runtime';
import type { ScheduledTask } from '../../shared/scheduled';

const task: ScheduledTask = {
  id: 'daily-brief',
  title: 'Morning brief',
  prompt: 'Summarize what needs my attention.',
  schedule: { kind: 'daily', timeOfDay: '09:00' },
  enabled: true,
  source: 'user',
  createdAt: 1,
  updatedAt: 1,
  nextRunAt: 2,
  runCount: 0,
  status: 'running',
};

const runFinishedPushes = () => h.sent.filter((event) => event.channel === 'scheduled:run-finished');

beforeEach(() => {
  h.sent.length = 0;
  h.notifications.length = 0;
  h.chatResult = { ok: true };
  h.chatThrows = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('scheduled run completion signal', () => {
  it('notifies and pushes to the renderer when a run succeeds', async () => {
    const result = await __testing.executeScheduledTask(task);

    expect(result).toEqual({ sessionId: 'session-1' });
    expect(h.notifications).toHaveLength(1);
    expect(h.notifications[0].shown).toBe(true);
    expect(h.notifications[0].options.body).toContain('completed');
    expect(runFinishedPushes()).toEqual([
      {
        channel: 'scheduled:run-finished',
        payload: { taskId: 'daily-brief', title: 'Morning brief', ok: true },
      },
    ]);
  });

  it('announces a failed run instead of leaving it silent, and still rethrows', async () => {
    h.chatResult = { ok: false, error: 'model unavailable' };

    await expect(__testing.executeScheduledTask(task)).rejects.toThrow('model unavailable');

    expect(h.notifications).toHaveLength(1);
    expect(h.notifications[0].shown).toBe(true);
    expect(h.notifications[0].options.body).toContain('model unavailable');
    expect(runFinishedPushes()[0].payload).toEqual({
      taskId: 'daily-brief',
      title: 'Morning brief',
      ok: false,
      error: 'model unavailable',
    });
  });

  it('announces a run that threw before producing a result', async () => {
    h.chatThrows = new Error('engine exploded');

    await expect(__testing.executeScheduledTask(task)).rejects.toThrow('engine exploded');
    expect(runFinishedPushes()[0].payload).toMatchObject({ ok: false, error: 'engine exploded' });
  });

  it('holds the notification until it closes so it cannot be collected mid-show', async () => {
    const before = __testing.pendingNotificationCount();
    await __testing.executeScheduledTask(task);

    expect(__testing.pendingNotificationCount()).toBe(before + 1);
    h.notifications[0].handlers.get('close')?.();
    expect(__testing.pendingNotificationCount()).toBe(before);
  });

  it('drops a held notification after the hold window when close never fires', async () => {
    vi.useFakeTimers();
    try {
      const before = __testing.pendingNotificationCount();
      await __testing.executeScheduledTask(task);
      expect(__testing.pendingNotificationCount()).toBe(before + 1);

      vi.advanceTimersByTime(60_000);
      expect(__testing.pendingNotificationCount()).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });
});
