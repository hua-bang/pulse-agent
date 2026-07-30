/**
 * Scheduled task IPC.
 *
 * Channels:
 *   scheduled:list
 *   scheduled:create
 *   scheduled:update
 *   scheduled:remove
 *   scheduled:run-now
 *   scheduled:cancel-run
 *   scheduled:run-progress-get
 *   scheduled:changed       (main → renderer push)
 *   scheduled:run-finished  (main → renderer push, success AND failure)
 *   scheduled:run-progress  (main → renderer push, see ./run-progress.ts)
 */

import { ipcMain } from 'electron';
import type { ScheduledTaskInput, ScheduledTaskPatch } from '../../shared/scheduled';
import { cancelScheduledRun, getScheduledRunProgress, getScheduledTaskService } from './runtime';

export function setupScheduledTaskIpc(): void {
  const service = getScheduledTaskService();

  ipcMain.handle('scheduled:list', async () => {
    try {
      return { ok: true, tasks: await service.listTasks() };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('scheduled:create', async (_event, input: ScheduledTaskInput) => {
    try {
      return { ok: true, task: await service.createTask(input) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(
    'scheduled:update',
    async (_event, payload: { taskId: string; patch: ScheduledTaskPatch }) => {
      try {
        return { ok: true, task: await service.updateTask(payload.taskId, payload.patch) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );

  ipcMain.handle('scheduled:remove', async (_event, taskId: string) => {
    try {
      await service.removeTask(taskId);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('scheduled:run-now', async (_event, taskId: string) => {
    try {
      const task = await service.runTaskNow(taskId);
      return task.lastError
        ? { ok: false, task, error: task.lastError }
        : { ok: true, task };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('scheduled:cancel-run', (_event, taskId: string) => cancelScheduledRun(taskId));

  ipcMain.handle('scheduled:run-progress-get', (_event, taskId: string) => ({
    ok: true,
    progress: getScheduledRunProgress(taskId),
  }));
}
