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
 * Compact duration for a run that is still going. Unit letters rather than
 * translated words: this string ticks every second next to a spinner, where a
 * stable narrow shape matters more than prose.
 */
export const formatElapsed = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
};

/**
 * What the background run is doing right now, for the chat banner and the
 * pending placeholder. Falls back to the generic "working on this task" line
 * when no progress has arrived — a run started before this build, or a snapshot
 * that has not landed yet, must not render a blank status.
 */
export const runProgressLabel = (
  progress: ScheduledRunProgress | undefined,
  t: Translate,
): string => {
  if (!progress) return t('scheduled.runningInline');
  if (progress.cancelRequested) return t('scheduled.progressStopping');
  if (progress.phase === 'writing') return t('scheduled.progressWriting');
  if (progress.phase === 'tool') {
    const current = [...progress.steps].reverse().find((step) => step.status === 'running');
    if (current) {
      return t('scheduled.progressTool', { step: current.index, tool: current.name });
    }
  }
  if (progress.toolCalls > 0) {
    return t('scheduled.progressThinkingAfter', { steps: progress.toolCalls });
  }
  return progress.phase === 'starting'
    ? t('scheduled.progressStarting')
    : t('scheduled.progressThinking');
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
