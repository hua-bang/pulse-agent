import {
  DAILY_SUMMARY_PROMPT,
  DAILY_SUMMARY_TASK_ID,
  DAILY_SUMMARY_TITLE,
  MEMORY_REPORT_PROMPT,
  MEMORY_REPORT_TASK_ID,
  MEMORY_REPORT_TITLE,
  type ScheduledRunFinished,
  type ScheduledSchedule,
  type ScheduledTask,
} from '../../../../../shared/scheduled';
import type { useI18n } from '../../../i18n';

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

const BUILT_IN_COPY = {
  'daily-summary': {
    id: DAILY_SUMMARY_TASK_ID,
    title: DAILY_SUMMARY_TITLE,
    prompt: DAILY_SUMMARY_PROMPT,
    titleKey: 'scheduled.dailySummary.title' as const,
    promptKey: 'scheduled.dailySummary.prompt' as const,
  },
  'memory-report': {
    id: MEMORY_REPORT_TASK_ID,
    title: MEMORY_REPORT_TITLE,
    prompt: MEMORY_REPORT_PROMPT,
    titleKey: 'scheduled.memoryReport.title' as const,
    promptKey: 'scheduled.memoryReport.prompt' as const,
  },
};

/**
 * Main seeds built-in reports in English because it does not know the UI
 * language. Show the translation until the user edits the text; a saved edit
 * becomes the stored value and is shown as typed.
 */
export const localizeBuiltInTasks = (tasks: ScheduledTask[], t: Translate): ScheduledTask[] =>
  tasks.map((task) => {
    const spec = task.source === 'user' ? undefined : BUILT_IN_COPY[task.source];
    if (!spec) return task;
    return {
      ...task,
      title: task.title === spec.title ? t(spec.titleKey) : task.title,
      prompt: task.prompt === spec.prompt ? t(spec.promptKey) : task.prompt,
    };
  });

/** Run notices carry the stored title, so they need the same translation. */
export const localizeRunTitle = (run: ScheduledRunFinished, t: Translate): string => {
  for (const spec of Object.values(BUILT_IN_COPY)) {
    if (run.taskId === spec.id && run.title === spec.title) return t(spec.titleKey);
  }
  return run.title;
};

/**
 * The editor shows the translated built-in text and submits every field. Map
 * an unchanged translation back to the seeded English, so a cadence-only
 * edit keeps the stored text, and the other language still shows its own.
 */
export const restoreBuiltInTaskInput = <T extends { title?: string; prompt?: string }>(
  task: ScheduledTask,
  input: T,
  t: Translate,
): T => {
  const spec = task.source === 'user' ? undefined : BUILT_IN_COPY[task.source];
  if (!spec) return input;
  return {
    ...input,
    ...(input.title === t(spec.titleKey) ? { title: spec.title } : {}),
    ...(input.prompt === t(spec.promptKey) ? { prompt: spec.prompt } : {}),
  };
};
