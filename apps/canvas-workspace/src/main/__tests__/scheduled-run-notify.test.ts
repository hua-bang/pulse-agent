import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Guards the completion signal for a scheduled run: one renderer push per
 * finished attempt, success AND failure. The failure path used to announce
 * nothing at all — the throw happened before the announcement, leaving
 * `lastError` in the list as the only trace.
 *
 * There is deliberately no OS notification; `assertNoOsNotification` keeps a
 * future edit from quietly reintroducing that second channel.
 */
const h = vi.hoisted(() => ({
  sent: [] as Array<{ channel: string; payload: unknown }>,
  osNotifications: 0,
  chatResult: { ok: true } as { ok: boolean; error?: string },
  chatThrows: null as Error | null,
}));

vi.mock('electron', () => {
  class FakeNotification {
    static isSupported = () => true;
    constructor() {
      h.osNotifications += 1;
    }
    on() { return this; }
    show() { /* counted in the constructor */ }
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

/** The completion signal is in-app only — no second, unreliable OS channel. */
const assertNoOsNotification = () => expect(h.osNotifications).toBe(0);

beforeEach(() => {
  h.sent.length = 0;
  h.osNotifications = 0;
  h.chatResult = { ok: true };
  h.chatThrows = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('scheduled run completion signal', () => {
  it('pushes exactly one in-app announcement when a run succeeds', async () => {
    const result = await __testing.executeScheduledTask(task);

    expect(result).toEqual({ sessionId: 'session-1' });
    assertNoOsNotification();
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

    assertNoOsNotification();
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
});
