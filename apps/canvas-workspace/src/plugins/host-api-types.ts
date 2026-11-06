import type { ScheduledSchedule } from '../shared/scheduled';

/**
 * How a repeating plugin job recurs. Same shape as the app's scheduled
 * tasks, but an `interval` may be as short as one minute.
 */
export type PluginRepeat = ScheduledSchedule;

/** What a schedule handler receives when its time comes. */
export interface PluginScheduleRun {
  id: string;
  /** The time this run was due, in ms since the epoch. */
  scheduledAt: number;
  /** The time the host started the handler. */
  startedAt: number;
  /**
   * More than a minute after `scheduledAt`, for example because the app was
   * closed at that time. The host runs a missed slot once, at the next start.
   */
  late: boolean;
}

export type PluginScheduleHandler = (run: PluginScheduleRun) => void | Promise<void>;

export interface PluginScheduleEntry {
  id: string;
  kind: 'every' | 'at';
  nextRunAt: number;
  lastRunAt?: number;
}

/**
 * Timed jobs owned by the host. Every method is async because the host
 * loads the scheduler on first use. Register jobs in `activate`: the host keeps
 * only the timing state on disk, so the plugin registers its handlers again
 * on every start. The host remembers what already ran, so a restart neither
 * repeats a run nor drops a missed one. Every job stops when the plugin is
 * disabled or reloaded.
 */
export interface PluginScheduleApi {
  /** Run `handler` on a repeating rule. Registering an id again replaces it. */
  every(id: string, repeat: PluginRepeat, handler: PluginScheduleHandler): Promise<void>;
  /**
   * Run `handler` once at `time` (ms since the epoch, an ISO string, or a
   * Date). Registering an id again with a new time moves it; the same time
   * that already ran does nothing.
   */
  at(id: string, time: number | string | Date, handler: PluginScheduleHandler): Promise<void>;
  cancel(id: string): Promise<void>;
  list(): Promise<PluginScheduleEntry[]>;
}

export interface PluginNotificationInput {
  title: string;
  body?: string;
  /** A route this plugin registered, opened when the user clicks the notification. */
  path?: string;
}

/**
 * `in-app`: the app window had focus, so the host showed a toast there.
 * `system`: the host showed an OS notification.
 * `none`: no window and no OS notification support.
 */
export type PluginNotificationDelivery = 'in-app' | 'system' | 'none';
