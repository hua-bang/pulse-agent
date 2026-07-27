import type { ScheduledSchedule, ScheduledWeekday } from '../../../../shared/scheduled';
import type { useI18n } from '../../i18n';

type Translate = ReturnType<typeof useI18n>['t'];

/** Indexed by `Date#getDay()` — 0 = Sunday. */
export const WEEKDAY_KEYS = [
  'scheduled.weekday.0',
  'scheduled.weekday.1',
  'scheduled.weekday.2',
  'scheduled.weekday.3',
  'scheduled.weekday.4',
  'scheduled.weekday.5',
  'scheduled.weekday.6',
] as const;

export const intervalLabel = (minutes: number, t: Translate): string => {
  if (minutes === 30) return t('scheduled.interval.30m');
  if (minutes === 60) return t('scheduled.interval.1h');
  if (minutes === 360) return t('scheduled.interval.6h');
  if (minutes === 1440) return t('scheduled.interval.daily');
  if (minutes === 10080) return t('scheduled.interval.weekly');
  return t('scheduled.interval.custom', { minutes });
};

export const weekdayLabel = (weekday: ScheduledWeekday, t: Translate): string =>
  t(WEEKDAY_KEYS[weekday]);

export const scheduleLabel = (schedule: ScheduledSchedule, t: Translate): string => {
  if (schedule.kind === 'daily') return t('scheduled.cadence.dailyAt', { time: schedule.timeOfDay });
  if (schedule.kind === 'weekly') {
    return t('scheduled.cadence.weeklyAt', {
      day: weekdayLabel(schedule.weekday, t),
      time: schedule.timeOfDay,
    });
  }
  return intervalLabel(schedule.intervalMinutes, t);
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
