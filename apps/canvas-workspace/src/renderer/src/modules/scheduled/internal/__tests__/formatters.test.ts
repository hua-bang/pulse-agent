import { describe, expect, it } from 'vitest';
import {
  MEMORY_REPORT_PROMPT,
  MEMORY_REPORT_TITLE,
  type ScheduledTask,
} from '../../../../../../shared/scheduled';
import type { I18nKey } from '../../../../i18n/messages';
import { zhMessages } from '../../../../i18n/messages-zh';
import { localizeBuiltInTasks, localizeRunTitle, restoreBuiltInTaskInput } from '../formatters';

const zh = (key: I18nKey) => zhMessages[key];

const task = (patch: Partial<ScheduledTask>): ScheduledTask => ({
  id: 'memory-report',
  title: MEMORY_REPORT_TITLE,
  prompt: MEMORY_REPORT_PROMPT,
  schedule: { kind: 'weekly', weekday: 1, timeOfDay: '09:00' },
  enabled: false,
  source: 'memory-report',
  createdAt: 1,
  updatedAt: 1,
  nextRunAt: 2,
  runCount: 0,
  status: 'idle',
  ...patch,
});

describe('built-in task translation', () => {
  it('translates the seeded report until the user edits it', () => {
    const [seeded, edited, user] = localizeBuiltInTasks([
      task({}),
      task({ title: 'My weekly digest' }),
      task({ id: 'u', source: 'user' }),
    ], zh);

    expect(seeded).toMatchObject({ title: '记忆周报', prompt: zh('scheduled.memoryReport.prompt') });
    expect(edited).toMatchObject({ title: 'My weekly digest', prompt: zh('scheduled.memoryReport.prompt') });
    expect(user).toMatchObject({ title: MEMORY_REPORT_TITLE, prompt: MEMORY_REPORT_PROMPT });
  });

  it('saves an unchanged translation as the seeded English text', () => {
    const [shown] = localizeBuiltInTasks([task({})], zh);
    const schedule = { kind: 'weekly' as const, weekday: 2 as const, timeOfDay: '10:00' };
    expect(restoreBuiltInTaskInput(shown, { title: shown.title, prompt: shown.prompt, schedule }, zh))
      .toEqual({ title: MEMORY_REPORT_TITLE, prompt: MEMORY_REPORT_PROMPT, schedule });
    expect(restoreBuiltInTaskInput(shown, { title: '周报', prompt: shown.prompt, schedule }, zh))
      .toMatchObject({ title: '周报', prompt: MEMORY_REPORT_PROMPT });
    expect(restoreBuiltInTaskInput(task({ source: 'user' }), { title: '记忆周报' }, zh))
      .toEqual({ title: '记忆周报' });
  });

  it('translates the report title in run notices', () => {
    const run = { taskId: 'memory-report', title: MEMORY_REPORT_TITLE, ok: true, trigger: 'schedule' as const };
    expect(localizeRunTitle(run, zh)).toBe('记忆周报');
    expect(localizeRunTitle({ ...run, taskId: 'other' }, zh)).toBe(MEMORY_REPORT_TITLE);
  });
});
