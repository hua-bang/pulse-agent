import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledTask } from '../../shared/scheduled';
import { ScheduledTaskService } from '../scheduled/scheduled-task-service';

describe('ScheduledTaskService', () => {
  let root: string;
  let statePath: string;

  beforeEach(async () => {
    root = join(tmpdir(), `scheduled-task-service-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    statePath = join(root, 'scheduled-tasks.json');
    await fs.mkdir(root, { recursive: true });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('creates a user task with a minimum 30-minute interval and a durable next run', async () => {
    const now = Date.UTC(2026, 6, 26, 9, 0);
    const service = new ScheduledTaskService({
      statePath,
      now: () => now,
      execute: vi.fn(),
    });

    await expect(service.createTask({
      title: 'Too frequent',
      prompt: 'Check my work.',
      schedule: { kind: 'interval', intervalMinutes: 15 },
    })).rejects.toThrow(/30/);

    const task = await service.createTask({
      title: 'Project pulse',
      prompt: 'Summarize important workspace changes.',
      schedule: { kind: 'interval', intervalMinutes: 30 },
    });

    expect(task).toMatchObject({
      title: 'Project pulse',
      prompt: 'Summarize important workspace changes.',
      schedule: { kind: 'interval', intervalMinutes: 30 },
      enabled: true,
      source: 'user',
      nextRunAt: now + 30 * 60_000,
      runCount: 0,
    });

    const restored = new ScheduledTaskService({
      statePath,
      now: () => now,
      execute: vi.fn(),
    });
    expect(await restored.listTasks()).toEqual([task]);
  });

  it('runs a due task once, advances its schedule, and records success', async () => {
    const start = Date.UTC(2026, 6, 26, 9, 0);
    let now = start;
    const execute = vi.fn(async () => ({ sessionId: 'session-1' }));
    const service = new ScheduledTaskService({
      statePath,
      now: () => now,
      execute,
    });
    const created = await service.createTask({
      title: 'Project pulse',
      prompt: 'Summarize important workspace changes.',
      schedule: { kind: 'interval', intervalMinutes: 30 },
    });

    await service.runDueTasks(start + 30 * 60_000 - 1);
    expect(execute).not.toHaveBeenCalled();

    now = start + 30 * 60_000;
    await service.runDueTasks(now);
    await service.runDueTasks(now);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ id: created.id }),
      { trigger: 'schedule' },
    );
    expect(await service.getTask(created.id)).toMatchObject({
      lastAttemptAt: now,
      lastSuccessAt: now,
      lastSessionId: 'session-1',
      nextRunAt: now + 30 * 60_000,
      runCount: 1,
    });
  });

  it('records a failed attempt without retrying on every scheduler check', async () => {
    const start = Date.UTC(2026, 6, 26, 9, 0);
    let now = start;
    const execute = vi.fn(async () => {
      throw new Error('model unavailable');
    });
    const service = new ScheduledTaskService({
      statePath,
      now: () => now,
      execute,
    });
    const task = await service.createTask({
      title: 'Project pulse',
      prompt: 'Summarize important workspace changes.',
      schedule: { kind: 'interval', intervalMinutes: 30 },
    });

    now += 30 * 60_000;
    await service.runDueTasks(now);
    await service.runDueTasks(now + 1);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(await service.getTask(task.id)).toMatchObject({
      lastAttemptAt: now,
      lastError: 'model unavailable',
      nextRunAt: now + 30 * 60_000,
      runCount: 1,
    });
  });

  it('runs on demand without moving the recurring next-run time', async () => {
    const start = Date.UTC(2026, 6, 26, 9, 0);
    const execute = vi.fn(async () => ({ sessionId: 'session-manual' }));
    const service = new ScheduledTaskService({
      statePath,
      now: () => start + 5 * 60_000,
      execute,
    });
    const task = await service.createTask({
      title: 'Project pulse',
      prompt: 'Summarize important workspace changes.',
      schedule: { kind: 'interval', intervalMinutes: 30 },
    });

    await service.startTaskNow(task.id, async () => 'prepared-manual-session');
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if ((await service.getTask(task.id))?.status === 'idle') break;
      await Promise.resolve();
    }

    expect(await service.getTask(task.id)).toMatchObject({
      nextRunAt: start + 35 * 60_000,
      lastSessionId: 'session-manual',
      runCount: 1,
    });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ id: task.id }),
      { trigger: 'manual', sessionId: 'prepared-manual-session' },
    );
  });

  it('starts a manual run without waiting for completion', async () => {
    const start = Date.UTC(2026, 6, 26, 9, 0);
    let finishExecution: (() => void) | undefined;
    const execute = vi.fn(() => new Promise<void>((resolve) => {
      finishExecution = resolve;
    }));
    const service = new ScheduledTaskService({ statePath, now: () => start, execute });
    const task = await service.createTask({
      title: 'Project pulse',
      prompt: 'Summarize important workspace changes.',
      schedule: { kind: 'interval', intervalMinutes: 30 },
    });

    const started = await service.startTaskNow(task.id, async () => 'main-owned-session');

    expect(started.task.status).toBe('running');
    expect(started.sessionId).toBe('main-owned-session');
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ id: task.id }),
      { trigger: 'manual', sessionId: 'main-owned-session' },
    );

    finishExecution?.();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if ((await service.getTask(task.id))?.status === 'idle') break;
      await Promise.resolve();
    }
    expect((await service.getTask(task.id))?.status).toBe('idle');
  });

  it('reserves a manual task before preparing its session', async () => {
    const start = Date.UTC(2026, 6, 26, 9, 0);
    let finishPreparation: ((sessionId: string) => void) | undefined;
    let finishExecution: (() => void) | undefined;
    const execute = vi.fn(() => new Promise<void>((resolve) => {
      finishExecution = resolve;
    }));
    const service = new ScheduledTaskService({ statePath, now: () => start, execute });
    const task = await service.createTask({
      title: 'Project pulse',
      prompt: 'Summarize important workspace changes.',
      schedule: { kind: 'interval', intervalMinutes: 30 },
    });
    const first = service.startTaskNow(task.id, () => new Promise<string>((resolve) => {
      finishPreparation = resolve;
    }));

    await expect(service.startTaskNow(task.id, async () => 'orphan-session'))
      .rejects.toThrow('already running');
    finishPreparation?.('reserved-session');
    await expect(first).resolves.toMatchObject({ sessionId: 'reserved-session' });

    finishExecution?.();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if ((await service.getTask(task.id))?.status === 'idle') break;
      await Promise.resolve();
    }
  });

  it('wakes at a newly created task exact due time between heartbeat checks', async () => {
    vi.useFakeTimers();
    const start = Date.UTC(2026, 6, 26, 9, 0);
    vi.setSystemTime(start);
    let resolveExecution: (() => void) | undefined;
    const executionStarted = new Promise<void>((resolve) => {
      resolveExecution = resolve;
    });
    const execute = vi.fn(async () => {
      resolveExecution?.();
      return { sessionId: 'session-exact' };
    });
    const service = new ScheduledTaskService({
      statePath,
      execute,
    });
    try {
      service.start();

      await vi.advanceTimersByTimeAsync(10 * 60_000);
      await service.createTask({
        title: 'Half-hour pulse',
        prompt: 'Check for important changes.',
        schedule: { kind: 'interval', intervalMinutes: 30 },
      });

      await vi.advanceTimersByTimeAsync(30 * 60_000 - 1);
      expect(execute).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await executionStarted;
      expect(execute).toHaveBeenCalledTimes(1);
      let completed: ScheduledTask | undefined = (await service.listTasks())[0];
      for (let attempt = 0; attempt < 10 && !completed?.lastSuccessAt; attempt += 1) {
        completed = await service.getTask((await service.listTasks())[0]!.id);
      }
      expect(completed?.lastSuccessAt).toBe(start + 40 * 60_000);
    } finally {
      service.stop();
    }
  });

  it('seeds the stable weekly memory report once and leaves it disabled until the user opts in', async () => {
    // 2026-07-26 is a Sunday, so the seeded Monday slot is the next day.
    const now = new Date(2026, 6, 26, 9, 0).getTime();
    const service = new ScheduledTaskService({
      statePath,
      now: () => now,
      execute: vi.fn(),
    });

    const first = await service.ensureMemoryReportTask();
    const second = await service.ensureMemoryReportTask();

    expect(first).toMatchObject({
      id: 'memory-report',
      source: 'memory-report',
      schedule: { kind: 'weekly', weekday: 1, timeOfDay: '09:00' },
      enabled: false,
      nextRunAt: new Date(2026, 6, 27, 9, 0).getTime(),
    });
    expect(second).toEqual(first);
    expect(await service.listTasks()).toHaveLength(1);
  });

  it('leaves an already-seeded memory report on its stored schedule', async () => {
    const now = new Date(2026, 6, 26, 9, 0).getTime();
    await fs.writeFile(statePath, JSON.stringify({
      version: 1,
      tasks: [{
        id: 'memory-report',
        title: 'Memory report',
        prompt: 'Review the last 7 days of Canvas activity and prepare a memory report.',
        intervalMinutes: 7 * 24 * 60,
        enabled: true,
        source: 'memory-report',
        createdAt: now,
        updatedAt: now,
        nextRunAt: now + 7 * 24 * 60 * 60_000,
        runCount: 3,
        status: 'idle',
      }],
    }), 'utf-8');

    const service = new ScheduledTaskService({ statePath, now: () => now, execute: vi.fn() });
    const seeded = await service.ensureMemoryReportTask();

    expect(seeded).toMatchObject({
      schedule: { kind: 'interval', intervalMinutes: 7 * 24 * 60 },
      enabled: true,
      runCount: 3,
    });
  });

  it('pins a daily task to the next local wall-clock slot instead of a relative offset', async () => {
    const now = new Date(2026, 6, 26, 14, 30).getTime();
    const service = new ScheduledTaskService({ statePath, now: () => now, execute: vi.fn() });

    const task = await service.createTask({
      title: 'Morning brief',
      prompt: 'Summarize what needs my attention.',
      schedule: { kind: 'daily', timeOfDay: '09:00' },
    });

    expect(task.nextRunAt).toBe(new Date(2026, 6, 27, 9, 0).getTime());

    const beforeToday = new Date(2026, 6, 26, 8, 0).getTime();
    const early = new ScheduledTaskService({ statePath, now: () => beforeToday, execute: vi.fn() });
    await early.updateTask(task.id, { schedule: { kind: 'daily', timeOfDay: '09:00' } });
    expect((await early.getTask(task.id))?.nextRunAt).toBe(new Date(2026, 6, 26, 9, 0).getTime());
  });

  it('pins a weekly task to the next matching local weekday', async () => {
    // 2026-07-26 is a Sunday; the next Monday is 2026-07-27.
    const now = new Date(2026, 6, 26, 14, 30).getTime();
    const service = new ScheduledTaskService({ statePath, now: () => now, execute: vi.fn() });

    const monday = await service.createTask({
      title: 'Week kickoff',
      prompt: 'Plan the week.',
      schedule: { kind: 'weekly', weekday: 1, timeOfDay: '08:15' },
    });
    expect(monday.nextRunAt).toBe(new Date(2026, 6, 27, 8, 15).getTime());

    // Same weekday as `now`, but the slot has already passed today.
    const sunday = await service.createTask({
      title: 'Week wrap-up',
      prompt: 'Review the week.',
      schedule: { kind: 'weekly', weekday: 0, timeOfDay: '10:00' },
    });
    expect(sunday.nextRunAt).toBe(new Date(2026, 7, 2, 10, 0).getTime());
  });

  it('catches up a missed absolute slot exactly once and realigns to the next one', async () => {
    const created = new Date(2026, 6, 26, 14, 30).getTime();
    let now = created;
    const execute = vi.fn(async () => ({ sessionId: 'session-catch-up' }));
    const service = new ScheduledTaskService({ statePath, now: () => now, execute });
    const task = await service.createTask({
      title: 'Morning brief',
      prompt: 'Summarize what needs my attention.',
      schedule: { kind: 'daily', timeOfDay: '09:00' },
    });

    // The app was closed across three 09:00 slots and reopens mid-afternoon.
    now = new Date(2026, 6, 30, 15, 0).getTime();
    await service.runDueTasks(now);
    await service.runDueTasks(now);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(await service.getTask(task.id)).toMatchObject({
      lastSuccessAt: now,
      nextRunAt: new Date(2026, 6, 31, 9, 0).getTime(),
      runCount: 1,
    });
  });

  it('reads pre-schedule records by lifting their interval into the schedule union', async () => {
    const now = Date.UTC(2026, 6, 26, 9, 0);
    await fs.writeFile(statePath, JSON.stringify({
      version: 1,
      tasks: [{
        id: 'legacy',
        title: 'Legacy pulse',
        prompt: 'Summarize important workspace changes.',
        intervalMinutes: 360,
        enabled: true,
        source: 'user',
        createdAt: now,
        updatedAt: now,
        nextRunAt: now + 360 * 60_000,
        runCount: 0,
        status: 'idle',
      }],
    }), 'utf-8');

    const service = new ScheduledTaskService({ statePath, now: () => now, execute: vi.fn() });
    const [task] = await service.listTasks();

    expect(task).toMatchObject({ id: 'legacy', schedule: { kind: 'interval', intervalMinutes: 360 } });
    expect(task).not.toHaveProperty('intervalMinutes');
  });
});
