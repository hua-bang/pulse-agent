import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest';
import { promises as fs } from 'fs';

// The tool writes through the real ScheduledTaskService; pin its state file to
// a sandbox and capture the renderer broadcast each write fires.
const { statePath, sandboxDir, sentChannels } = vi.hoisted(() => {
  const base = process.env.TMPDIR || process.env.TEMP || '/tmp';
  const trailing = base.endsWith('/') ? '' : '/';
  const dir = `${base}${trailing}scheduled-tools-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { sandboxDir: dir, statePath: `${dir}/scheduled-tasks.json`, sentChannels: [] as string[] };
});

process.env.PULSE_CANVAS_SCHEDULED_TASKS_PATH = statePath;

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        isMinimized: () => false,
        restore: () => undefined,
        show: () => undefined,
        focus: () => undefined,
        webContents: { send: (channel: string) => { sentChannels.push(channel); } },
      },
    ],
  },
  Notification: { isSupported: () => false },
}));

// scheduled/runtime pulls the agent service in only to execute a run; stub it
// so this test does not drag in the whole engine graph.
vi.mock('../ipc', () => ({ getCanvasAgentService: () => ({}) }));

import { createScheduledTools } from '../tools/scheduled';

const tools = createScheduledTools();

const call = async (
  tool: keyof typeof tools,
  input: unknown,
): Promise<Record<string, any>> =>
  JSON.parse(await tools[tool].execute(input as never, {} as never));

beforeAll(async () => {
  await fs.mkdir(sandboxDir, { recursive: true });
});

afterAll(async () => {
  await fs.rm(sandboxDir, { recursive: true, force: true });
  delete process.env.PULSE_CANVAS_SCHEDULED_TASKS_PATH;
});

describe('scheduled task tools', () => {
  it('keeps every scheduled-task tool deferred so it stays out of default reach', () => {
    expect(Object.keys(tools).sort()).toEqual([
      'scheduled_task_create',
      'scheduled_task_list',
      'scheduled_task_update',
    ]);
    for (const tool of Object.values(tools)) {
      expect(tool.defer_loading).toBe(true);
    }
  });

  it('creates a wall-clock task, reports its cadence, and surfaces it to the renderer', async () => {
    const created = await call('scheduled_task_create', {
      title: 'Morning brief',
      prompt: 'Summarize what needs my attention today.',
      schedule: { kind: 'daily', timeOfDay: '09:00' },
    });

    expect(created.ok).toBe(true);
    expect(created.task).toMatchObject({
      title: 'Morning brief',
      cadence: 'Every day at 09:00 local time',
      schedule: { kind: 'daily', timeOfDay: '09:00' },
      enabled: true,
      source: 'user',
      runCount: 0,
    });
    expect(new Date(created.task.nextRunAt).getHours()).toBe(9);
    expect(sentChannels).toContain('scheduled:changed');

    const listed = await call('scheduled_task_list', {});
    expect(listed.tasks).toHaveLength(1);
    expect(listed.tasks[0].id).toBe(created.task.id);
  });

  it('rejects a schedule missing the field its kind requires, without writing', async () => {
    const before = await call('scheduled_task_list', {});

    const missingInterval = await call('scheduled_task_create', {
      title: 'Broken',
      prompt: 'Do a thing.',
      schedule: { kind: 'interval' },
    });
    expect(missingInterval).toMatchObject({ ok: false });
    expect(missingInterval.error).toMatch(/intervalMinutes is required/);

    const missingWeekday = await call('scheduled_task_create', {
      title: 'Broken',
      prompt: 'Do a thing.',
      schedule: { kind: 'weekly', timeOfDay: '09:00' },
    });
    expect(missingWeekday.error).toMatch(/weekday is required/);

    const belowFloor = await call('scheduled_task_create', {
      title: 'Too frequent',
      prompt: 'Do a thing.',
      schedule: { kind: 'interval', intervalMinutes: 5 },
    });
    expect(belowFloor.error).toMatch(/30/);

    const after = await call('scheduled_task_list', {});
    expect(after.total).toBe(before.total);
  });

  it('updates an existing task and re-anchors its next run', async () => {
    const created = await call('scheduled_task_create', {
      title: 'Week wrap-up',
      prompt: 'Review the week.',
      schedule: { kind: 'interval', intervalMinutes: 60 },
    });

    const updated = await call('scheduled_task_update', {
      taskId: created.task.id,
      title: 'Friday wrap-up',
      schedule: { kind: 'weekly', weekday: 5, timeOfDay: '17:30' },
    });

    expect(updated.ok).toBe(true);
    expect(updated.task).toMatchObject({
      id: created.task.id,
      title: 'Friday wrap-up',
      prompt: 'Review the week.',
      cadence: 'Every Friday at 17:30 local time',
    });
    const next = new Date(updated.task.nextRunAt);
    expect(next.getDay()).toBe(5);
    expect(next.getHours()).toBe(17);
    expect(next.getMinutes()).toBe(30);
  });

  it('reports an unknown task id instead of throwing', async () => {
    const result = await call('scheduled_task_update', { taskId: 'missing', enabled: false });
    expect(result).toMatchObject({ ok: false });
    expect(result.error).toMatch(/not found/i);
  });
});
