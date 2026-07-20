import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { TaskScheduler } from '../task-scheduler';

describe('TaskScheduler', () => {
  let root: string;
  let statePath: string;

  beforeEach(async () => {
    root = join(tmpdir(), `scheduler-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    statePath = join(root, 'scheduler-state.json');
    await fs.mkdir(root, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const scheduler = (log?: (m: string, d?: string) => void): TaskScheduler =>
    new TaskScheduler({ statePath, log: log ?? (() => undefined) });

  it('runs a never-run task on the first check and persists lastRun', async () => {
    const s = scheduler();
    let runs = 0;
    s.register({ id: 'job', interval: 'weekly', run: async () => { runs += 1; } });

    const now = Date.now();
    await s.runDueTasks(now);
    expect(runs).toBe(1);

    const state = JSON.parse(await fs.readFile(statePath, 'utf-8'));
    expect(state.lastRun.job).toBe(now);
  });

  it('skips a task within its period and catches up across restarts once past due', async () => {
    const week = 7 * 86_400_000;
    const start = Date.now();

    const first = scheduler();
    let runs = 0;
    first.register({ id: 'job', interval: 'weekly', run: async () => { runs += 1; } });
    await first.runDueTasks(start);
    await first.runDueTasks(start + week - 1000);
    expect(runs).toBe(1);

    // Fresh instance = app restart: state comes from disk, task is past due.
    const second = scheduler();
    second.register({ id: 'job', interval: 'weekly', run: async () => { runs += 1; } });
    await second.runDueTasks(start + week + 1000);
    expect(runs).toBe(2);
  });

  it('a failing run consumes the period instead of retrying every check', async () => {
    const logs: string[] = [];
    const s = scheduler((m, d) => logs.push(`${m}${d ? `: ${d}` : ''}`));
    let attempts = 0;
    s.register({
      id: 'flaky',
      interval: 'weekly',
      run: async () => {
        attempts += 1;
        throw new Error('no model configured');
      },
    });

    const now = Date.now();
    await s.runDueTasks(now);
    await s.runDueTasks(now + 60 * 60_000); // next hourly check
    expect(attempts).toBe(1);
    expect(logs.some((l) => l.includes('flaky') && l.includes('no model configured'))).toBe(true);
  });

  it('does not re-enter a task that is still running', async () => {
    const s = scheduler();
    let started = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    s.register({
      id: 'slow',
      interval: 'weekly',
      run: async () => {
        started += 1;
        await gate;
      },
    });

    const now = Date.now();
    const firstRun = s.runDueTasks(now);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await s.runDueTasks(now + 1);
    expect(started).toBe(1);
    release();
    await firstRun;
  });

  it('rejects duplicate task ids', () => {
    const s = scheduler();
    s.register({ id: 'dup', interval: 'weekly', run: async () => undefined });
    expect(() => s.register({ id: 'dup', interval: 'weekly', run: async () => undefined })).toThrow(/dup/);
  });

  it('start() fires the delayed first check; stop() before the delay cancels it', async () => {
    // Real (short) timers: the scheduler's check does real fs IO, which fake
    // timers cannot flush deterministically.
    const s = new TaskScheduler({ statePath, initialDelayMs: 30, checkEveryMs: 60_000, log: () => undefined });
    let runs = 0;
    s.register({ id: 'job', interval: 'weekly', run: async () => { runs += 1; } });
    s.start();
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(runs).toBe(1);
    s.stop();

    const stopped = new TaskScheduler({
      statePath: join(root, 'other-state.json'),
      initialDelayMs: 50,
      checkEveryMs: 60_000,
      log: () => undefined,
    });
    let stoppedRuns = 0;
    stopped.register({ id: 'job', interval: 'weekly', run: async () => { stoppedRuns += 1; } });
    stopped.start();
    stopped.stop();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(stoppedRuns).toBe(0);
  });
});
