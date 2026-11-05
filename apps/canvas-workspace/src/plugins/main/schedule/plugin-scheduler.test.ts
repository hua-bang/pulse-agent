import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }));

const { PluginScheduler } = await import('./plugin-scheduler');

const MINUTE = 60_000;
let dir = '';
let statePath = '';
let schedulers: InstanceType<typeof PluginScheduler>[] = [];

function createScheduler() {
  const scheduler = new PluginScheduler({ statePath: () => statePath, now: () => Date.now() });
  schedulers.push(scheduler);
  return scheduler;
}

/** A fresh scheduler on the same state file, as after an app restart. */
async function restart(previous: InstanceType<typeof PluginScheduler>) {
  await previous.flush();
  previous.stop();
  return createScheduler();
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'plugin-scheduler-'));
  statePath = join(dir, 'plugin-schedules.json');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date('2026-11-05T09:00:00'));
});

afterEach(async () => {
  for (const scheduler of schedulers) scheduler.stop();
  vi.useRealTimers();
  await Promise.all(schedulers.map((scheduler) => scheduler.flush()));
  schedulers = [];
  await rm(dir, { recursive: true, force: true });
});

describe('PluginScheduler', () => {
  it('runs a one-off job at its time, once, and remembers it across restarts', async () => {
    const scheduler = createScheduler();
    const handler = vi.fn();
    const slot = Date.now() + 5 * MINUTE;
    scheduler.at('calendar', 'event-1:start', slot, handler);
    expect(scheduler.list('calendar')).toEqual([{ id: 'event-1:start', kind: 'at', nextRunAt: slot }]);

    await vi.advanceTimersByTimeAsync(5 * MINUTE - 1);
    expect(handler).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(handler).toHaveBeenCalledWith({ id: 'event-1:start', scheduledAt: slot, startedAt: slot, late: false });
    expect(scheduler.list('calendar')).toEqual([]);

    const next = await restart(scheduler);
    const again = vi.fn();
    next.at('calendar', 'event-1:start', new Date(slot), again);
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(again).not.toHaveBeenCalled();
  });

  it('runs a one-off job missed while the app was closed once, marked late', async () => {
    const scheduler = createScheduler();
    const slot = Date.now() - 30 * MINUTE;
    const handler = vi.fn();
    scheduler.at('calendar', 'event-2:end', new Date(slot).toISOString(), handler);

    await vi.advanceTimersByTimeAsync(0);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({ scheduledAt: slot, late: true });
  });

  it('moves a one-off job when the plugin registers it with a new time', async () => {
    const scheduler = createScheduler();
    const handler = vi.fn();
    scheduler.at('calendar', 'event-3:start', Date.now() + 5 * MINUTE, handler);
    scheduler.at('calendar', 'event-3:start', Date.now() + 20 * MINUTE, handler);

    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(handler).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('repeats an interval job and runs one missed slot after a restart', async () => {
    const scheduler = createScheduler();
    const handler = vi.fn();
    scheduler.every('calendar', 'sync', { kind: 'interval', intervalMinutes: 15 }, handler);

    await vi.advanceTimersByTimeAsync(45 * MINUTE);
    expect(handler).toHaveBeenCalledTimes(3);

    const next = await restart(scheduler);
    // The app stays closed for two hours.
    vi.setSystemTime(Date.now() + 120 * MINUTE);
    const resumed = vi.fn();
    next.every('calendar', 'sync', { kind: 'interval', intervalMinutes: 15 }, resumed);
    await vi.advanceTimersByTimeAsync(0);
    expect(resumed).toHaveBeenCalledTimes(1);
    expect(resumed.mock.calls[0][0].late).toBe(true);
    await vi.advanceTimersByTimeAsync(15 * MINUTE);
    expect(resumed).toHaveBeenCalledTimes(2);
  });

  it('runs a daily job at the local wall-clock time', async () => {
    const scheduler = createScheduler();
    const handler = vi.fn();
    scheduler.every('calendar', 'digest', { kind: 'daily', timeOfDay: '09:30' }, handler);

    await vi.advanceTimersByTimeAsync(30 * MINUTE);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(new Date(handler.mock.calls[0][0].scheduledAt).getHours()).toBe(9);
    expect(scheduler.list('calendar')[0].nextRunAt).toBe(new Date('2026-11-06T09:30:00').getTime());
  });

  it('stops a plugin\'s jobs when it deactivates, without touching other plugins', async () => {
    const scheduler = createScheduler();
    const mine = vi.fn();
    const other = vi.fn();
    scheduler.every('calendar', 'sync', { kind: 'interval', intervalMinutes: 1 }, mine);
    scheduler.every('weather', 'sync', { kind: 'interval', intervalMinutes: 1 }, other);

    scheduler.clearPlugin('calendar');
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(mine).not.toHaveBeenCalled();
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('keeps going after a handler throws, and cancel forgets the job', async () => {
    const scheduler = createScheduler();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const handler = vi.fn(() => { throw new Error('boom'); });
    scheduler.every('calendar', 'sync', { kind: 'interval', intervalMinutes: 1 }, handler);

    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    expect(handler).toHaveBeenCalledTimes(2);
    scheduler.cancel('calendar', 'sync');
    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    expect(handler).toHaveBeenCalledTimes(2);
    await scheduler.flush();
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    expect(state.plugins.calendar).toEqual({});
    error.mockRestore();
  });

  it('rejects bad input', () => {
    const scheduler = createScheduler();
    expect(() => scheduler.every('p', 'bad id', { kind: 'interval', intervalMinutes: 5 }, vi.fn())).toThrow(/Invalid plugin schedule id/);
    expect(() => scheduler.every('p', 'fast', { kind: 'interval', intervalMinutes: 0.5 }, vi.fn())).toThrow(/at least 1 minute/);
    expect(() => scheduler.at('p', 'when', 'not a date', vi.fn())).toThrow(/Invalid plugin schedule time/);
  });
});
