import { describe, expect, it } from 'vitest';
import type { ScheduledTask } from '../../shared/scheduled';
import { setAgentScheduledPort } from './scheduled-port';
import { scheduledTaskTitles } from './scheduled-session-names';

const task = (id: string, title: string): ScheduledTask => ({
  id,
  title,
  prompt: title,
  schedule: { kind: 'daily', timeOfDay: '09:00' },
  enabled: true,
  source: 'user',
  createdAt: 1,
  updatedAt: 1,
  nextRunAt: 2,
  runCount: 0,
  status: 'idle',
});

const unavailableMutation = async (): Promise<never> => {
  throw new Error('not used');
};

describe('scheduledTaskTitles', () => {
  it('projects injected scheduled tasks into session display names', async () => {
    setAgentScheduledPort({
      listTasks: async () => [task('a', 'Morning brief'), task('b', 'Weekly review')],
      createTask: unavailableMutation,
      updateTask: unavailableMutation,
    });

    expect(await scheduledTaskTitles()).toEqual(new Map([
      ['a', 'Morning brief'],
      ['b', 'Weekly review'],
    ]));
  });

  it('degrades to an empty map when scheduled storage is unavailable', async () => {
    setAgentScheduledPort({
      listTasks: async () => { throw new Error('storage unavailable'); },
      createTask: unavailableMutation,
      updateTask: unavailableMutation,
    });

    expect(await scheduledTaskTitles()).toEqual(new Map());
  });
});
