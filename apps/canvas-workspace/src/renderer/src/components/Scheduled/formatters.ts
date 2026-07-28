import type {
  ScheduledRunProgress,
  ScheduledSchedule,
  ScheduledWeekday,
} from '../../../../shared/scheduled';
import type { useI18n } from '../../i18n';

type Translate = ReturnType<typeof useI18n>['t'];
type Language = ReturnType<typeof useI18n>['language'];

/**
 * Weekday names come from `Intl`, not the message catalogue: the platform
 * already knows them in every locale, and 7 hardcoded strings per language
 * would ship in the entry chunk for no benefit. 2026-01-04 is a Sunday, so
 * adding the weekday index lands on the right day.
 */
const WEEKDAY_ANCHOR = Date.UTC(2026, 0, 4);

export const weekdayNames = (language: Language): string[] => {
  const format = new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
    weekday: 'long',
    timeZone: 'UTC',
  });
  return Array.from({ length: 7 }, (_, index) =>
    format.format(new Date(WEEKDAY_ANCHOR + index * 86_400_000)));
};

export const intervalLabel = (minutes: number, t: Translate): string => {
  if (minutes === 30) return t('scheduled.interval.30m');
  if (minutes === 60) return t('scheduled.interval.1h');
  if (minutes === 360) return t('scheduled.interval.6h');
  if (minutes === 1440) return t('scheduled.interval.daily');
  if (minutes === 10080) return t('scheduled.interval.weekly');
  return t('scheduled.interval.custom', { minutes });
};

export const scheduleLabel = (
  schedule: ScheduledSchedule,
  t: Translate,
  language: Language,
): string => {
  if (schedule.kind === 'daily') return t('scheduled.cadence.dailyAt', { time: schedule.timeOfDay });
  if (schedule.kind === 'weekly') {
    return t('scheduled.cadence.weeklyAt', {
      day: weekdayNames(language)[schedule.weekday],
      time: schedule.timeOfDay,
    });
  }
  return intervalLabel(schedule.intervalMinutes, t);
};

/**
 * `m:ss` (or `h:mm:ss` past the hour) — a clock, not prose, so it stays short
 * enough for the dock's status line and reads the same in every language.
 */
export const elapsedLabel = (elapsedMs: number): string => {
  const total = Math.max(0, Math.floor(elapsedMs / 1000));
  const seconds = String(total % 60).padStart(2, '0');
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  if (hours === 0) return `${minutes}:${seconds}`;
  return `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`;
};

const activityLabel = (progress: ScheduledRunProgress | undefined, t: Translate): string => {
  if (progress?.activity === 'tool' && progress.toolName) {
    return t('scheduled.activity.tool', { tool: progress.toolName });
  }
  if (progress?.activity === 'thinking') return t('scheduled.activity.thinking');
  if (progress?.activity === 'writing') return t('scheduled.activity.writing');
  return t('scheduled.activity.starting');
};

/**
 * One line answering "is this thing still working, and on what" — the
 * question a multi-minute unattended run leaves open. Elapsed time is the
 * liveness part and is always shown once a start time is known; the activity
 * and step count come from the run's progress pushes.
 */
export const runStatusLine = (
  progress: ScheduledRunProgress | undefined,
  elapsedMs: number | undefined,
  t: Translate,
): string => {
  const parts = [];
  if (elapsedMs !== undefined) {
    parts.push(t('scheduled.runningFor', { elapsed: elapsedLabel(elapsedMs) }));
  }
  parts.push(activityLabel(progress, t));
  if (progress && progress.steps > 0) parts.push(t('scheduled.runStep', { step: progress.steps }));
  return parts.join(' · ');
};

export const timeLabel = (value: number | undefined, fallback: string): string => {
  if (!value) return fallback;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
};
