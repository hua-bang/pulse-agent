/**
 * Lightweight periodic task scheduler for the Electron main process.
 *
 * Purpose-built for "run roughly every week/month, even though the app is
 * not always open": per-task `lastRun` is persisted to disk, a start-up
 * check catches up on periods missed while the app was closed, and a
 * low-frequency interval covers long-running sessions. Deliberately NOT a
 * cron: no expressions, no sub-hour precision, no queues/retries — a task
 * that fails logs and consumes its period (no hourly retry storm when e.g.
 * no model is configured). First registration with no recorded lastRun is
 * ANCHORED, not run: enabling a feature must never trigger background work
 * immediately — a first full period passes before the first automatic run
 * (features wanting "see one now" offer an explicit user-initiated action,
 * e.g. the memory report's settings try-it button).
 *
 * Generic infrastructure: the scheduler knows nothing about its tasks.
 * First consumer is the scheduled memory report (bootstrap, flag-gated).
 */

import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

export type TaskIntervalPreset = 'weekly' | 'monthly';

export interface ScheduledTaskDef {
  /** Stable unique id — the persistence key for lastRun. Kebab-case. */
  id: string;
  interval: TaskIntervalPreset | number;
  run: () => Promise<void>;
}

export interface TaskSchedulerOptions {
  /** Override the persisted-state path (tests). */
  statePath?: string;
  /** Delay before the first due-check after start(). Keeps LLM/background work off the cold-start path. */
  initialDelayMs?: number;
  /** How often to re-check while the app stays open. */
  checkEveryMs?: number;
  log?: (message: string, detail?: string) => void;
}

interface SchedulerState {
  version: 1;
  lastRun: Record<string, number>;
}

const WEEK_MS = 7 * 86_400_000;
const MONTH_MS = 30 * 86_400_000;
const DEFAULT_INITIAL_DELAY_MS = 45_000;
const DEFAULT_CHECK_EVERY_MS = 60 * 60_000;

function defaultStatePath(): string {
  return (
    process.env.PULSE_CANVAS_SCHEDULER_STATE ||
    join(homedir(), '.pulse-coder', 'canvas', 'scheduler-state.json')
  );
}

function intervalMs(interval: TaskIntervalPreset | number): number {
  if (interval === 'weekly') return WEEK_MS;
  if (interval === 'monthly') return MONTH_MS;
  return Math.max(60_000, interval);
}

export class TaskScheduler {
  private tasks = new Map<string, ScheduledTaskDef>();
  private running = new Set<string>();
  private statePath: string;
  private initialDelayMs: number;
  private checkEveryMs: number;
  private log: (message: string, detail?: string) => void;
  private initialTimer: NodeJS.Timeout | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;
  // Serializes state-file read-modify-write cycles (same pattern as
  // memory-store's per-file queue).
  private stateQueue: Promise<unknown> = Promise.resolve();

  constructor(options: TaskSchedulerOptions = {}) {
    this.statePath = options.statePath || defaultStatePath();
    this.initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
    this.checkEveryMs = options.checkEveryMs ?? DEFAULT_CHECK_EVERY_MS;
    this.log = options.log ?? ((message, detail) => console.info(`[scheduler] ${message}`, detail ?? ''));
  }

  register(def: ScheduledTaskDef): void {
    if (this.tasks.has(def.id)) {
      throw new Error(`Scheduler task id already registered: ${def.id}`);
    }
    this.tasks.set(def.id, def);
  }

  /** Start the delayed catch-up check and the long-session interval. */
  start(): void {
    if (this.initialTimer || this.intervalTimer) return;
    this.initialTimer = setTimeout(() => {
      void this.runDueTasks();
    }, this.initialDelayMs);
    this.intervalTimer = setInterval(() => {
      void this.runDueTasks();
    }, this.checkEveryMs);
  }

  stop(): void {
    if (this.initialTimer) clearTimeout(this.initialTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.initialTimer = null;
    this.intervalTimer = null;
  }

  /**
   * Run every task whose period has elapsed (or that has never run).
   * Exposed for tests; the timers call this too.
   */
  async runDueTasks(now: number = Date.now()): Promise<void> {
    const state = await this.readState();
    for (const task of this.tasks.values()) {
      if (this.running.has(task.id)) continue;
      const last = state.lastRun[task.id];
      if (last === undefined) {
        // First sighting: anchor the period instead of running (see module doc).
        await this.writeLastRun(task.id, now);
        continue;
      }
      if (now - last < intervalMs(task.interval)) continue;

      this.running.add(task.id);
      // Record the attempt up front: success and failure both consume the
      // period, so a persistently failing task retries next period, not on
      // every hourly check.
      await this.writeLastRun(task.id, now);
      try {
        await task.run();
        this.log(`task ${task.id} completed`);
      } catch (err) {
        this.log(`task ${task.id} failed`, err instanceof Error ? err.message : String(err));
      } finally {
        this.running.delete(task.id);
      }
    }
  }

  private async readState(): Promise<SchedulerState> {
    try {
      const raw = await fs.readFile(this.statePath, 'utf-8');
      const parsed = JSON.parse(raw) as SchedulerState;
      const lastRun: Record<string, number> = {};
      for (const [k, v] of Object.entries(parsed.lastRun ?? {})) {
        if (typeof v === 'number' && Number.isFinite(v)) lastRun[k] = v;
      }
      return { version: 1, lastRun };
    } catch {
      return { version: 1, lastRun: {} };
    }
  }

  private writeLastRun(id: string, at: number): Promise<void> {
    const next = this.stateQueue.then(async () => {
      const state = await this.readState();
      state.lastRun[id] = at;
      await fs.mkdir(dirname(this.statePath), { recursive: true });
      const tmp = `${this.statePath}.tmp-${at}-${Math.random().toString(36).slice(2, 8)}`;
      await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf-8');
      await fs.rename(tmp, this.statePath);
    });
    this.stateQueue = next.catch(() => undefined);
    return next;
  }
}
