import { app } from 'electron';
import { promises as fs, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { computeNextRunAt, normalizeSchedule, type ScheduledSchedule } from '../../../shared/scheduled';
import { activations } from '../registry';
import type {
  PluginRepeat,
  PluginScheduleEntry,
  PluginScheduleHandler,
} from '../../host-api-types';

/** Longest single wait. A short cap keeps runs on time after sleep or a clock change. */
const MAX_WAIT_MS = 60_000;
/** A run that starts this long after its slot is reported as late. */
const LATE_AFTER_MS = 60_000;
/** A finished one-off run is remembered this long, so re-registering it is a no-op. */
const DONE_AT_RETENTION_MS = 7 * 24 * 60 * 60_000;
const MAX_JOBS_PER_PLUGIN = 500;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

interface JobState {
  /** `every`: when the job was first registered; counts until the first run. */
  since?: number;
  /** `every`: when the last run started. */
  lastRunAt?: number;
  /** `at`: the slot that already ran. */
  doneAt?: number;
  /** `at`: when that run finished; retention counts from here. */
  finishedAt?: number;
}

interface PersistedState {
  version: 1;
  plugins: Record<string, Record<string, JobState>>;
}

interface Job {
  pluginId: string;
  /** The plugin activation that registered the job. */
  owner: object;
  id: string;
  kind: 'every' | 'at';
  repeat?: ScheduledSchedule;
  handler: PluginScheduleHandler;
  nextRunAt: number;
}

export interface PluginSchedulerOptions {
  statePath: () => string;
  now?: () => number;
  /** Whether `owner` is still the plugin's current activation. */
  isCurrent: (pluginId: string, owner: object) => boolean;
}

const jobKey = (pluginId: string, id: string): string => `${pluginId}\u0000${id}`;

function normalizeRepeat(repeat: PluginRepeat): ScheduledSchedule {
  if (repeat?.kind === 'interval') {
    const minutes = repeat.intervalMinutes;
    if (!Number.isFinite(minutes) || minutes < 1) {
      throw new Error('Plugin schedule interval must be at least 1 minute');
    }
    return { kind: 'interval', intervalMinutes: Math.round(minutes) };
  }
  return normalizeSchedule(repeat);
}

function toTime(time: number | string | Date): number {
  const value = time instanceof Date ? time.getTime() : typeof time === 'string' ? Date.parse(time) : time;
  if (!Number.isFinite(value)) throw new Error(`Invalid plugin schedule time: ${String(time)}`);
  return value;
}

/**
 * Host timer for plugin jobs. Handlers live in memory and come back when the
 * plugin activates again; only the timing state is on disk. One timer serves
 * every job and waits at most a minute, so it needs no per-job timers.
 */
export class PluginScheduler {
  private readonly statePath: () => string;
  private readonly now: () => number;
  private readonly isCurrent: PluginSchedulerOptions['isCurrent'];
  private readonly jobs = new Map<string, Job>();
  /** Keys whose handler is running; a replaced job keeps its key busy. */
  private readonly running = new Set<string>();
  private state: PersistedState | null = null;
  private timer: NodeJS.Timeout | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: PluginSchedulerOptions) {
    this.statePath = options.statePath;
    this.now = options.now ?? Date.now;
    this.isCurrent = options.isCurrent;
  }

  every(pluginId: string, owner: object, id: string, repeat: PluginRepeat, handler: PluginScheduleHandler): void {
    this.assertJob(pluginId, owner, id, handler);
    const normalized = normalizeRepeat(repeat);
    const saved = this.jobState(pluginId, id);
    let anchor = saved?.lastRunAt ?? saved?.since;
    if (anchor === undefined) {
      // Save the first registration, so a slot missed before the first run
      // still counts after a restart.
      anchor = this.now();
      (this.loadState().plugins[pluginId] ??= {})[id] = { since: anchor };
      this.save();
    }
    // Counted from the anchor, a slot missed while the app was closed is
    // already due, so it runs once at the next tick.
    const nextRunAt = computeNextRunAt(normalized, anchor);
    this.put({ pluginId, owner, id, kind: 'every', repeat: normalized, handler, nextRunAt });
  }

  at(pluginId: string, owner: object, id: string, time: number | string | Date, handler: PluginScheduleHandler): void {
    this.assertJob(pluginId, owner, id, handler);
    const slot = toTime(time);
    if (this.jobState(pluginId, id)?.doneAt === slot) {
      this.removeJob(pluginId, id);
      return;
    }
    this.put({ pluginId, owner, id, kind: 'at', handler, nextRunAt: slot });
  }

  cancel(pluginId: string, owner: object, id: string): void {
    this.assertOwner(pluginId, owner);
    this.removeJob(pluginId, id);
    const jobs = this.loadState().plugins[pluginId];
    if (jobs && id in jobs) {
      delete jobs[id];
      this.save();
    }
  }

  list(pluginId: string, owner: object): PluginScheduleEntry[] {
    this.assertOwner(pluginId, owner);
    this.dropStaleJobs();
    return Array.from(this.jobs.values())
      .filter((job) => job.pluginId === pluginId)
      .map((job) => {
        const lastRunAt = this.jobState(pluginId, job.id)?.lastRunAt;
        return {
          id: job.id,
          kind: job.kind,
          nextRunAt: job.nextRunAt,
          ...(lastRunAt !== undefined ? { lastRunAt } : {}),
        };
      })
      .sort((a, b) => a.nextRunAt - b.nextRunAt);
  }

  /**
   * Drops the handlers of plugin activations that ended (disabled, reloaded,
   * or failed). Their timing state stays on disk for the next activation.
   */
  private dropStaleJobs(): void {
    for (const [key, job] of Array.from(this.jobs)) {
      if (!this.isCurrent(job.pluginId, job.owner)) this.jobs.delete(key);
    }
  }

  stop(): void {
    this.jobs.clear();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Resolves after pending state writes. For tests and shutdown. */
  async flush(): Promise<void> {
    await this.writeQueue;
  }

  private assertOwner(pluginId: string, owner: object): void {
    if (!this.isCurrent(pluginId, owner)) throw new Error(`Plugin ${pluginId} is no longer active`);
  }

  private assertJob(pluginId: string, owner: object, id: string, handler: unknown): void {
    this.assertOwner(pluginId, owner);
    if (!ID_PATTERN.test(id)) {
      throw new Error(`Invalid plugin schedule id "${id}": use 1-128 letters, digits, ".", "_", ":" or "-"`);
    }
    if (typeof handler !== 'function') throw new Error('Plugin schedule handler must be a function');
    const owned = Array.from(this.jobs.values()).filter((job) => job.pluginId === pluginId).length;
    if (!this.jobs.has(jobKey(pluginId, id)) && owned >= MAX_JOBS_PER_PLUGIN) {
      throw new Error(`A plugin may hold at most ${MAX_JOBS_PER_PLUGIN} scheduled jobs`);
    }
  }

  private put(job: Job): void {
    this.jobs.set(jobKey(job.pluginId, job.id), job);
    this.arm();
  }

  private removeJob(pluginId: string, id: string): void {
    this.jobs.delete(jobKey(pluginId, id));
    this.arm();
  }

  private arm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.dropStaleJobs();
    let soonest = Infinity;
    for (const [key, job] of this.jobs) {
      if (!this.running.has(key) && job.nextRunAt < soonest) soonest = job.nextRunAt;
    }
    if (soonest === Infinity) return;
    const wait = Math.min(Math.max(soonest - this.now(), 0), MAX_WAIT_MS);
    this.timer = setTimeout(() => this.tick(), wait);
    this.timer.unref?.();
  }

  private tick(): void {
    this.timer = null;
    this.dropStaleJobs();
    const now = this.now();
    for (const [key, job] of Array.from(this.jobs)) {
      if (!this.running.has(key) && job.nextRunAt <= now) void this.run(job, now);
    }
    this.arm();
  }

  private async run(job: Job, startedAt: number): Promise<void> {
    const key = jobKey(job.pluginId, job.id);
    this.running.add(key);
    const scheduledAt = job.nextRunAt;
    try {
      await job.handler({ id: job.id, scheduledAt, startedAt, late: startedAt - scheduledAt > LATE_AFTER_MS });
    } catch (err) {
      console.error(`[canvas-plugins] scheduled job ${job.pluginId}/${job.id} failed`, err);
    } finally {
      this.running.delete(key);
      this.recordRun(job, scheduledAt, startedAt);
      this.arm();
    }
  }

  private recordRun(job: Job, scheduledAt: number, startedAt: number): void {
    const plugins = this.loadState().plugins;
    const jobs = (plugins[job.pluginId] ??= {});
    // The plugin may have replaced or removed the job while its handler ran.
    const key = jobKey(job.pluginId, job.id);
    const current = this.jobs.get(key);
    if (job.kind === 'every') {
      jobs[job.id] = { lastRunAt: startedAt };
      if (current?.kind === 'every' && current.repeat) {
        current.nextRunAt = Math.max(current.nextRunAt, computeNextRunAt(current.repeat, startedAt));
      }
    } else {
      jobs[job.id] = { doneAt: scheduledAt, finishedAt: this.now() };
      if (current?.kind === 'at' && current.nextRunAt === scheduledAt) this.jobs.delete(key);
    }
    this.save();
  }

  private jobState(pluginId: string, id: string): JobState | undefined {
    return this.loadState().plugins[pluginId]?.[id];
  }

  private loadState(): PersistedState {
    if (this.state) return this.state;
    let state: PersistedState = { version: 1, plugins: {} };
    try {
      const parsed = JSON.parse(readFileSync(this.statePath(), 'utf8')) as PersistedState;
      if (parsed?.version === 1 && parsed.plugins && typeof parsed.plugins === 'object') state = parsed;
    } catch {
      // Missing or unreadable: start empty.
    }
    const cutoff = this.now() - DONE_AT_RETENTION_MS;
    for (const jobs of Object.values(state.plugins)) {
      for (const [id, job] of Object.entries(jobs)) {
        const finished = job.finishedAt ?? job.doneAt;
        if (finished !== undefined && finished < cutoff) delete jobs[id];
      }
    }
    this.state = state;
    return state;
  }

  private save(): void {
    const path = this.statePath();
    const text = JSON.stringify(this.loadState());
    this.writeQueue = this.writeQueue
      .then(async () => {
        await fs.mkdir(dirname(path), { recursive: true });
        const temp = `${path}.${process.pid}.tmp`;
        await fs.writeFile(temp, text, 'utf8');
        await fs.rename(temp, path);
      })
      .catch((err: unknown) => console.error('[canvas-plugins] could not save plugin schedules', err));
  }
}

let scheduler: PluginScheduler | null = null;

/** The app's plugin scheduler. Its state lives in `<userData>/plugin-schedules.json`. */
export function getPluginScheduler(): PluginScheduler {
  scheduler ??= new PluginScheduler({
    statePath: () => join(app.getPath('userData'), 'plugin-schedules.json'),
    isCurrent: (pluginId, owner) => activations.get(pluginId) === owner,
  });
  return scheduler;
}
