import type { useI18n } from '../../i18n';

type Translate = ReturnType<typeof useI18n>['t'];

export const intervalLabel = (minutes: number, t: Translate): string => {
  if (minutes === 30) return t('scheduled.interval.30m');
  if (minutes === 60) return t('scheduled.interval.1h');
  if (minutes === 360) return t('scheduled.interval.6h');
  if (minutes === 1440) return t('scheduled.interval.daily');
  if (minutes === 10080) return t('scheduled.interval.weekly');
  return t('scheduled.interval.custom', { minutes });
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
