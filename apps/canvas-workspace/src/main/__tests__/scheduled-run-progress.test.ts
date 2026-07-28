import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Guards the progress signal for a scheduled run. A run executes in main with
 * no renderer driving it, so without these pushes a multi-minute task shows
 * the same frozen "waiting for the result" line whether it is working or
 * wedged.
 *
 * The other half of the guard is volume: text deltas arrive in the thousands
 * per run and must NOT each produce a push.
 */
const h = vi.hoisted(() => ({
  sent: [] as Array<{ channel: string; payload: unknown }>,
  /** Drives the fake agent run's callbacks. */
  run: async (_callbacks: {
    onText: () => void;
    onToolCall: (call: { name: string }) => void;
    onToolResult: () => void;
  }) => { /* set per test */ },
}));

vi.mock('electron', () => ({
  Notification: class { static isSupported = () => false; },
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          send: (channel: string, payload: unknown) => { h.sent.push({ channel, payload }); },
        },
      },
    ],
  },
}));

vi.mock('../agent/ipc', () => ({
  getCanvasAgentService: () => ({
    chatWithScope: async (
      _scope: unknown,
      _message: string,
      onText: () => void,
      onToolCall: (call: { name: string }) => void,
      onToolResult: () => void,
    ) => {
      await h.run({ onText, onToolCall, onToolResult });
      return { ok: true };
    },
    resolveCurrentSessionId: async () => 'session-1',
  }),
}));

import { __testing, activeRunProgress } from '../scheduled/runtime';
import type { ScheduledRunProgress, ScheduledTask } from '../../shared/scheduled';

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

const progressPushes = (): ScheduledRunProgress[] => h.sent
  .filter((event) => event.channel === 'scheduled:run-progress')
  .map((event) => event.payload as ScheduledRunProgress);

beforeEach(() => {
  h.sent.length = 0;
  h.run = async () => undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('scheduled run progress', () => {
  it('reports every activity transition of a run', async () => {
    h.run = async ({ onText, onToolCall, onToolResult }) => {
      onToolCall({ name: 'notion_search' });
      onToolResult();
      onText();
      onToolCall({ name: 'feishu_calendar' });
      onToolResult();
      onText();
    };

    await __testing.executeScheduledTask(task);

    expect(progressPushes().map((p) => [p.activity, p.toolName, p.steps])).toEqual([
      ['starting', undefined, 0],
      ['tool', 'notion_search', 1],
      ['thinking', undefined, 1],
      ['writing', undefined, 1],
      ['tool', 'feishu_calendar', 2],
      ['thinking', undefined, 2],
      ['writing', undefined, 2],
    ]);
    expect(progressPushes().every((p) => p.taskId === 'daily-brief' && p.startedAt > 0)).toBe(true);
  });

  it('collapses a delta storm into a single writing push', async () => {
    h.run = async ({ onText }) => {
      for (let index = 0; index < 500; index += 1) onText();
    };

    await __testing.executeScheduledTask(task);

    expect(progressPushes().map((p) => p.activity)).toEqual(['starting', 'writing']);
  });

  it('exposes the run to surfaces that mount mid-run, and clears it when the run ends', async () => {
    let midRun: ScheduledRunProgress[] = [];
    h.run = async ({ onToolCall }) => {
      onToolCall({ name: 'notion_search' });
      midRun = activeRunProgress();
    };

    await __testing.executeScheduledTask(task);

    expect(midRun).toEqual([expect.objectContaining({ taskId: 'daily-brief', toolName: 'notion_search' })]);
    // A stale entry would leave the UI claiming work is still in flight.
    expect(activeRunProgress()).toEqual([]);
  });

  it('clears the in-flight entry when the run fails', async () => {
    h.run = async () => { throw new Error('engine exploded'); };

    await expect(__testing.executeScheduledTask(task)).rejects.toThrow('engine exploded');
    expect(activeRunProgress()).toEqual([]);
  });
});
