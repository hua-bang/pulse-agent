import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import { dirname, join } from 'path';
import { homedir } from 'os';
import type {
  ScheduledSchedule,
  ScheduledTask,
  ScheduledTaskExecutionResult,
  ScheduledTaskInput,
  ScheduledTaskPatch,
} from '../../shared/scheduled';
import { computeNextRunAt, normalizeSchedule } from '../../shared/scheduled';

interface ScheduledTaskState {
  version: 1;
  tasks: ScheduledTask[];
}

/** Pre-`schedule` records stored only a relative interval. */
type PersistedTask = ScheduledTask & { intervalMinutes?: number };

const WEEK_MINUTES = 7 * 24 * 60;
/** Monday 09:00 local. Weekday numbering matches `Date#getDay()`. */
const MEMORY_REPORT_SCHEDULE: ScheduledSchedule = { kind: 'weekly', weekday: 1, timeOfDay: '09:00' };
const DEFAULT_INITIAL_DELAY_MS = 45_000;
export const SCHEDULED_CHECK_EVERY_MS = 30 * 60_000;

export interface ScheduledTaskServiceOptions {
  statePath?: string;
  now?: () => number;
  execute: (task: ScheduledTask) => Promise<ScheduledTaskExecutionResult | void>;
  onChange?: (tasks: ScheduledTask[]) => void;
}

const defaultStatePath = (): string =>
  process.env.PULSE_CANVAS_SCHEDULED_TASKS_PATH
  || join(homedir(), '.pulse-coder', 'canvas', 'scheduled-tasks.json');

/**
 * Records written before absolute schedules existed carry `intervalMinutes`
 * instead of `schedule`; lift them on read so the rest of the service only
 * ever sees the union.
 */
const migratePersistedTask = ({ intervalMinutes, ...task }: PersistedTask): ScheduledTask => {
  if (task.schedule) return task;
  return {
    ...task,
    schedule: { kind: 'interval', intervalMinutes: intervalMinutes ?? WEEK_MINUTES },
  };
};

const normalizeRequiredText = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
};

export class ScheduledTaskService {
  private readonly statePath: string;
  private readonly now: () => number;
  private readonly execute: ScheduledTaskServiceOptions['execute'];
  private readonly onChange?: ScheduledTaskServiceOptions['onChange'];
  private queue: Promise<unknown> = Promise.resolve();
  private running = new Set<string>();
  private initialTimer: NodeJS.Timeout | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;
  private dueTimer: NodeJS.Timeout | null = null;
  private started = false;
  private timerGeneration = 0;

  constructor(options: ScheduledTaskServiceOptions) {
    this.statePath = options.statePath ?? defaultStatePath();
    this.now = options.now ?? Date.now;
    this.execute = options.execute;
    this.onChange = options.onChange;
  }

  async listTasks(): Promise<ScheduledTask[]> {
    const state = await this.readState();
    return state.tasks.map((task) => ({ ...task, status: this.running.has(task.id) ? 'running' : 'idle' }));
  }

  async getTask(taskId: string): Promise<ScheduledTask | undefined> {
    return (await this.listTasks()).find((task) => task.id === taskId);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.initialTimer = setTimeout(async () => {
      this.initialTimer = null;
      await this.runDueTasks().finally(() => this.refreshDueTimer());
    }, DEFAULT_INITIAL_DELAY_MS);
    this.intervalTimer = setInterval(async () => {
      await this.runDueTasks().finally(() => this.refreshDueTimer());
    }, SCHEDULED_CHECK_EVERY_MS);
  }

  stop(): void {
    this.started = false;
    this.timerGeneration += 1;
    if (this.initialTimer) clearTimeout(this.initialTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    if (this.dueTimer) clearTimeout(this.dueTimer);
    this.initialTimer = null;
    this.intervalTimer = null;
    this.dueTimer = null;
  }

  /**
   * Seeds the built-in weekly report at a predictable local slot (Monday
   * 09:00) rather than "7 days after whenever the app first launched", which
   * is the whole point of a weekly report. Seeding is one-shot: an install
   * that already has the task keeps its stored schedule untouched.
   */
  async ensureMemoryReportTask(): Promise<ScheduledTask> {
    const existing = await this.getTask('memory-report');
    if (existing) return existing;
    const createdAt = this.now();
    const schedule = MEMORY_REPORT_SCHEDULE;
    const task: ScheduledTask = {
      id: 'memory-report',
      title: 'Memory report',
      prompt: 'Review the last 7 days of Canvas activity and prepare a memory report.',
      schedule,
      enabled: false,
      source: 'memory-report',
      createdAt,
      updatedAt: createdAt,
      nextRunAt: computeNextRunAt(schedule, createdAt),
      runCount: 0,
      status: 'idle',
    };
    await this.mutate((state) => {
      if (!state.tasks.some((candidate) => candidate.id === task.id)) state.tasks.push(task);
    });
    return (await this.getTask(task.id))!;
  }

  async createTask(input: ScheduledTaskInput): Promise<ScheduledTask> {
    const createdAt = this.now();
    const schedule = normalizeSchedule(input.schedule);
    const task: ScheduledTask = {
      id: randomUUID(),
      title: normalizeRequiredText(input.title, 'Task title'),
      prompt: normalizeRequiredText(input.prompt, 'Task prompt'),
      schedule,
      enabled: input.enabled ?? true,
      source: 'user',
      createdAt,
      updatedAt: createdAt,
      nextRunAt: computeNextRunAt(schedule, createdAt),
      runCount: 0,
      status: 'idle',
    };
    await this.mutate((state) => {
      state.tasks.push(task);
    });
    return task;
  }

  async updateTask(taskId: string, patch: ScheduledTaskPatch): Promise<ScheduledTask> {
    let updated: ScheduledTask | undefined;
    await this.mutate((state) => {
      const task = state.tasks.find((candidate) => candidate.id === taskId);
      if (!task) throw new Error('Scheduled task not found');
      if (patch.title !== undefined) task.title = normalizeRequiredText(patch.title, 'Task title');
      if (patch.prompt !== undefined) task.prompt = normalizeRequiredText(patch.prompt, 'Task prompt');
      if (patch.schedule !== undefined) {
        task.schedule = normalizeSchedule(patch.schedule);
        task.nextRunAt = computeNextRunAt(task.schedule, this.now());
      }
      if (patch.enabled !== undefined) {
        task.enabled = patch.enabled;
        if (patch.enabled) task.nextRunAt = computeNextRunAt(task.schedule, this.now());
      }
      task.updatedAt = this.now();
      updated = { ...task };
    });
    return updated!;
  }

  async removeTask(taskId: string): Promise<void> {
    await this.mutate((state) => {
      const task = state.tasks.find((candidate) => candidate.id === taskId);
      if (!task) throw new Error('Scheduled task not found');
      if (task.source !== 'user') throw new Error('Built-in scheduled tasks cannot be removed');
      state.tasks = state.tasks.filter((candidate) => candidate.id !== taskId);
    });
  }

  async runTaskNow(taskId: string): Promise<ScheduledTask> {
    const task = await this.getTask(taskId);
    if (!task) throw new Error('Scheduled task not found');
    await this.runTask(task, false, this.now());
    return (await this.getTask(taskId))!;
  }

  async runDueTasks(now = this.now()): Promise<void> {
    const tasks = await this.listTasks();
    for (const task of tasks) {
      if (!task.enabled || task.nextRunAt > now || this.running.has(task.id)) continue;
      await this.runTask(task, true, now);
    }
  }

  private async runTask(task: ScheduledTask, advanceSchedule: boolean, attemptedAt: number): Promise<void> {
    if (this.running.has(task.id)) return;
    this.running.add(task.id);
    await this.mutate((state) => {
      const current = state.tasks.find((candidate) => candidate.id === task.id);
      if (!current) return;
      current.lastAttemptAt = attemptedAt;
      current.runCount += 1;
      current.lastError = undefined;
      if (advanceSchedule) current.nextRunAt = computeNextRunAt(current.schedule, attemptedAt);
    });
    try {
      const result = await this.execute({ ...task, status: 'running' });
      await this.mutate((state) => {
        const current = state.tasks.find((candidate) => candidate.id === task.id);
        if (!current) return;
        current.lastSuccessAt = attemptedAt;
        current.lastError = undefined;
        if (result?.sessionId) current.lastSessionId = result.sessionId;
      });
    } catch (error) {
      await this.mutate((state) => {
        const current = state.tasks.find((candidate) => candidate.id === task.id);
        if (!current) return;
        current.lastError = error instanceof Error ? error.message : String(error);
      });
    } finally {
      this.running.delete(task.id);
      await this.emitChange();
      await this.refreshDueTimer();
    }
  }

  private async refreshDueTimer(): Promise<void> {
    if (!this.started) return;
    const generation = ++this.timerGeneration;
    const tasks = await this.listTasks();
    if (!this.started || generation !== this.timerGeneration) return;
    this.applyDueTimer(tasks);
  }

  private scheduleDueTimer(tasks: ScheduledTask[]): void {
    if (!this.started) return;
    this.timerGeneration += 1;
    this.applyDueTimer(tasks);
  }

  private applyDueTimer(tasks: ScheduledTask[]): void {
    if (this.dueTimer) clearTimeout(this.dueTimer);
    const nextRunAt = tasks
      .filter((task) => task.enabled && !this.running.has(task.id))
      .reduce<number | undefined>(
        (earliest, task) => earliest === undefined ? task.nextRunAt : Math.min(earliest, task.nextRunAt),
        undefined,
      );
    if (nextRunAt === undefined) {
      this.dueTimer = null;
      return;
    }

    const delay = Math.min(
      SCHEDULED_CHECK_EVERY_MS,
      Math.max(0, nextRunAt - this.now()),
    );
    this.dueTimer = setTimeout(async () => {
      this.dueTimer = null;
      await this.runDueTasks().finally(() => this.refreshDueTimer());
    }, delay);
  }

  private async readState(): Promise<ScheduledTaskState> {
    try {
      const raw = await fs.readFile(this.statePath, 'utf-8');
      const parsed = JSON.parse(raw) as { tasks?: PersistedTask[] };
      return {
        version: 1,
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks.map(migratePersistedTask) : [],
      };
    } catch {
      return { version: 1, tasks: [] };
    }
  }

  private mutate(change: (state: ScheduledTaskState) => void): Promise<void> {
    const next = this.queue.then(async () => {
      const state = await this.readState();
      change(state);
      await fs.mkdir(dirname(this.statePath), { recursive: true });
      const tmp = `${this.statePath}.tmp-${process.pid}-${randomUUID()}`;
      await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf-8');
      await fs.rename(tmp, this.statePath);
      this.onChange?.(state.tasks.map((task) => ({ ...task, status: this.running.has(task.id) ? 'running' : 'idle' })));
      this.scheduleDueTimer(state.tasks);
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async emitChange(): Promise<void> {
    this.onChange?.(await this.listTasks());
  }
}
