import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScheduledTaskService } from '../scheduled-task-service';

describe('ScheduledTaskService', () => {
  let root: string;
  let statePath: string;

  beforeEach(async () => {
    root = join(tmpdir(), `scheduled-task-service-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    statePath = join(root, 'scheduled-tasks.json');
    await fs.mkdir(root, { recursive: true });
  });

  afterEach(async () => {
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
      intervalMinutes: 15,
    })).rejects.toThrow(/30/);

    const task = await service.createTask({
      title: 'Project pulse',
      prompt: 'Summarize important workspace changes.',
      intervalMinutes: 30,
    });

    expect(task).toMatchObject({
      title: 'Project pulse',
      prompt: 'Summarize important workspace changes.',
      intervalMinutes: 30,
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
      intervalMinutes: 30,
    });

    await service.runDueTasks(start + 30 * 60_000 - 1);
    expect(execute).not.toHaveBeenCalled();

    now = start + 30 * 60_000;
    await service.runDueTasks(now);
    await service.runDueTasks(now);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ id: created.id }));
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
      intervalMinutes: 30,
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
      intervalMinutes: 30,
    });

    await service.runTaskNow(task.id);

    expect(await service.getTask(task.id)).toMatchObject({
      nextRunAt: start + 35 * 60_000,
      lastSessionId: 'session-manual',
      runCount: 1,
    });
  });

  it('seeds the stable weekly memory report once and leaves it disabled until the user opts in', async () => {
    const now = Date.UTC(2026, 6, 26, 9, 0);
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
      intervalMinutes: 7 * 24 * 60,
      enabled: false,
      nextRunAt: now + 7 * 24 * 60 * 60_000,
    });
    expect(second).toEqual(first);
    expect(await service.listTasks()).toHaveLength(1);
  });
});
