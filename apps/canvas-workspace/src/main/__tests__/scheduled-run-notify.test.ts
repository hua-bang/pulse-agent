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
  newSessionCalls: [] as unknown[],
  chatCalls: [] as unknown[][],
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
    newSessionForScope: async (scope: unknown) => {
      h.newSessionCalls.push(scope);
      return { ok: true, activeSessionId: 'session-1' };
    },
    chatWithScope: async (...args: unknown[]) => {
      h.chatCalls.push(args);
      if (h.chatThrows) throw h.chatThrows;
      return h.chatResult;
    },
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
  h.newSessionCalls.length = 0;
  h.chatCalls.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('scheduled run completion signal', () => {
  it('pushes exactly one in-app announcement when a run succeeds', async () => {
    const result = await (__testing.executeScheduledTask as unknown as (
      task: ScheduledTask,
      context: { trigger: 'schedule' },
    ) => Promise<{ sessionId?: string }>)(task, { trigger: 'schedule' });

    expect(result).toEqual({ sessionId: 'session-1' });
    expect(h.newSessionCalls).toEqual([{ kind: 'scheduled', taskId: 'daily-brief' }]);
    expect(h.chatCalls[0]?.[7]).toMatchObject({ expectedConversationSessionId: 'session-1' });
    assertNoOsNotification();
    expect(runFinishedPushes()).toEqual([
      {
        channel: 'scheduled:run-finished',
        payload: {
          taskId: 'daily-brief',
          title: 'Morning brief',
          ok: true,
          sessionId: 'session-1',
          trigger: 'schedule',
        },
      },
    ]);
  });

  it('announces a failed run instead of leaving it silent, and still rethrows', async () => {
    h.chatResult = { ok: false, error: 'model unavailable' };

    await expect((__testing.executeScheduledTask as unknown as (
      task: ScheduledTask,
      context: { trigger: 'schedule' },
    ) => Promise<unknown>)(task, { trigger: 'schedule' })).rejects.toThrow('model unavailable');

    assertNoOsNotification();
    expect(runFinishedPushes()[0].payload).toEqual({
      taskId: 'daily-brief',
      title: 'Morning brief',
      ok: false,
      error: 'model unavailable',
      sessionId: 'session-1',
      trigger: 'schedule',
    });
  });

  it('announces a run that threw before producing a result', async () => {
    h.chatThrows = new Error('engine exploded');

    await expect((__testing.executeScheduledTask as unknown as (
      task: ScheduledTask,
      context: { trigger: 'schedule' },
    ) => Promise<unknown>)(task, { trigger: 'schedule' })).rejects.toThrow('engine exploded');
    expect(runFinishedPushes()[0].payload).toMatchObject({ ok: false, error: 'engine exploded' });
  });
});
