import type { ScheduledSchedule, ScheduledWeekday } from '../../../../shared/scheduled';
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

export const timeLabel = (value: number | undefined, fallback: string): string => {
  if (!value) return fallback;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
};
