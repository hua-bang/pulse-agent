export const SCHEDULED_MIN_INTERVAL_MINUTES = 30;

/** Local-time weekday, matching `Date#getDay()` (0 = Sunday). */
export type ScheduledWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * How a task recurs.
 *
 * `interval` is the original relative cadence: the next run is always
 * "now + N minutes", anchored at create/enable/last-attempt time, so it
 * drifts with execution time and cannot express a wall-clock time.
 * `daily` / `weekly` pin the run to a LOCAL wall-clock `HH:mm`, so they
 * survive DST shifts by following the user's clock rather than a fixed
 * millisecond offset.
 */
export type ScheduledSchedule =
  | { kind: 'interval'; intervalMinutes: number }
  | { kind: 'daily'; timeOfDay: string }
  | { kind: 'weekly'; weekday: ScheduledWeekday; timeOfDay: string };

export type ScheduledTaskSource = 'user' | 'memory-report';
export type ScheduledTaskRunStatus = 'idle' | 'running';

/**
 * What started a run. `manual` is the Scheduled list's `Run now`, which also
 * opens the task's conversation — so the user is already looking at the
 * result and does not need to be told a second time. `schedule` is the
 * unattended path the sticky completion toast exists for.
 */
export type ScheduledRunTrigger = 'manual' | 'schedule';

export interface ScheduledTask {
  id: string;
  title: string;
  prompt: string;
  schedule: ScheduledSchedule;
  enabled: boolean;
  source: ScheduledTaskSource;
  createdAt: number;
  updatedAt: number;
  nextRunAt: number;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  lastError?: string;
  lastSessionId?: string;
  runCount: number;
  status: ScheduledTaskRunStatus;
}

export interface ScheduledTaskInput {
  title: string;
  prompt: string;
  schedule: ScheduledSchedule;
  enabled?: boolean;
}

export interface ScheduledTaskPatch {
  title?: string;
  prompt?: string;
  schedule?: ScheduledSchedule;
  enabled?: boolean;
}

export interface ScheduledTaskExecutionResult {
  sessionId?: string;
}

/** Emitted once per finished run attempt — success AND failure. */
export interface ScheduledRunFinished {
  taskId: string;
  title: string;
  ok: boolean;
  error?: string;
  trigger: ScheduledRunTrigger;
}

export interface ScheduledApi {
  list: () => Promise<{ ok: boolean; tasks?: ScheduledTask[]; error?: string }>;
  create: (
    input: ScheduledTaskInput,
  ) => Promise<{ ok: boolean; task?: ScheduledTask; error?: string }>;
  update: (
    taskId: string,
    patch: ScheduledTaskPatch,
  ) => Promise<{ ok: boolean; task?: ScheduledTask; error?: string }>;
  remove: (taskId: string) => Promise<{ ok: boolean; error?: string }>;
  runNow: (
    taskId: string,
  ) => Promise<{ ok: boolean; task?: ScheduledTask; error?: string }>;
  onChanged: (callback: (tasks: ScheduledTask[]) => void) => () => void;
  onRunFinished: (callback: (run: ScheduledRunFinished) => void) => () => void;
}

const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const parseTimeOfDay = (timeOfDay: string): { hour: number; minute: number } => {
  const match = TIME_OF_DAY_PATTERN.exec(typeof timeOfDay === 'string' ? timeOfDay.trim() : '');
  if (!match) throw new Error('Scheduled task time must be a 24-hour HH:mm value');
  return { hour: Number(match[1]), minute: Number(match[2]) };
};

export const formatTimeOfDay = (hour: number, minute: number): string =>
  `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

/** Validates and canonicalizes a schedule; throws with a user-facing message. */
export const normalizeSchedule = (schedule: ScheduledSchedule): ScheduledSchedule => {
  if (!schedule || typeof schedule !== 'object') throw new Error('Scheduled task cadence is required');
  if (schedule.kind === 'interval') {
    const { intervalMinutes } = schedule;
    if (!Number.isFinite(intervalMinutes) || intervalMinutes < SCHEDULED_MIN_INTERVAL_MINUTES) {
      throw new Error(`Scheduled task interval must be at least ${SCHEDULED_MIN_INTERVAL_MINUTES} minutes`);
    }
    return { kind: 'interval', intervalMinutes: Math.round(intervalMinutes) };
  }
  if (schedule.kind === 'daily') {
    const { hour, minute } = parseTimeOfDay(schedule.timeOfDay);
    return { kind: 'daily', timeOfDay: formatTimeOfDay(hour, minute) };
  }
  if (schedule.kind === 'weekly') {
    const { weekday } = schedule;
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      throw new Error('Scheduled task weekday must be 0 (Sunday) through 6 (Saturday)');
    }
    const { hour, minute } = parseTimeOfDay(schedule.timeOfDay);
    return { kind: 'weekly', weekday, timeOfDay: formatTimeOfDay(hour, minute) };
  }
  throw new Error(`Unsupported scheduled task cadence: ${String((schedule as { kind?: unknown }).kind)}`);
};

/**
 * Structural equality for two canonical schedules.
 *
 * The next-run clock is re-anchored whenever a schedule is written, so every
 * writer needs to tell "the user picked a new cadence" apart from "the form
 * resubmitted the cadence it was already showing". Compare both sides AFTER
 * `normalizeSchedule` — an off-canonical stored value (`9:00`) really is a
 * change and must re-anchor.
 */
export const isSameSchedule = (a: ScheduledSchedule, b: ScheduledSchedule): boolean => {
  if (a.kind === 'interval') return b.kind === 'interval' && a.intervalMinutes === b.intervalMinutes;
  if (a.kind === 'daily') return b.kind === 'daily' && a.timeOfDay === b.timeOfDay;
  return b.kind === 'weekly' && a.weekday === b.weekday && a.timeOfDay === b.timeOfDay;
};

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/**
 * English, machine-facing cadence summary for the scheduled-run prompt and
 * the agent tools. The localized UI label lives in the renderer's
 * `components/Scheduled/formatters.ts`.
 */
export const describeSchedule = (schedule: ScheduledSchedule): string => {
  if (schedule.kind === 'daily') return `Every day at ${schedule.timeOfDay} local time`;
  if (schedule.kind === 'weekly') {
    return `Every ${WEEKDAY_NAMES[schedule.weekday]} at ${schedule.timeOfDay} local time`;
  }
  const { intervalMinutes } = schedule;
  if (intervalMinutes % (7 * 24 * 60) === 0) return `Every ${intervalMinutes / (7 * 24 * 60)} week(s)`;
  if (intervalMinutes % (24 * 60) === 0) return `Every ${intervalMinutes / (24 * 60)} day(s)`;
  if (intervalMinutes % 60 === 0) return `Every ${intervalMinutes / 60} hour(s)`;
  return `Every ${intervalMinutes} minutes`;
};

/**
 * The first run strictly after `from`.
 *
 * Absolute schedules use local `Date` field arithmetic (not fixed
 * millisecond offsets) so a DST transition keeps the run at the same wall
 * clock. A missed absolute slot is not replayed per-slot: the caller runs
 * once on catch-up and this returns the NEXT slot after that attempt.
 */
export const computeNextRunAt = (schedule: ScheduledSchedule, from: number): number => {
  if (schedule.kind === 'interval') return from + schedule.intervalMinutes * 60_000;

  const { hour, minute } = parseTimeOfDay(schedule.timeOfDay);
  const candidate = new Date(from);
  candidate.setHours(hour, minute, 0, 0);

  if (schedule.kind === 'daily') {
    if (candidate.getTime() <= from) candidate.setDate(candidate.getDate() + 1);
    return candidate.getTime();
  }

  const dayDelta = (schedule.weekday - candidate.getDay() + 7) % 7;
  if (dayDelta > 0) candidate.setDate(candidate.getDate() + dayDelta);
  if (candidate.getTime() <= from) candidate.setDate(candidate.getDate() + 7);
  return candidate.getTime();
};
