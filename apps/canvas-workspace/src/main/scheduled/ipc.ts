/**
 * Scheduled task IPC.
 *
 * Channels:
 *   scheduled:list
 *   scheduled:create
 *   scheduled:update
 *   scheduled:remove
 *   scheduled:run-now
 *   scheduled:progress      (snapshot of in-flight runs)
 *   scheduled:changed       (main → renderer push)
 *   scheduled:run-finished  (main → renderer push, success AND failure)
 *   scheduled:run-progress  (main → renderer push, per activity transition)
 */

import { ipcMain } from 'electron';
import type { ScheduledTaskInput, ScheduledTaskPatch } from '../../shared/scheduled';
import { activeRunProgress, getScheduledTaskService } from './runtime';

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

  ipcMain.handle('scheduled:progress', () => ({ ok: true, runs: activeRunProgress() }));

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
}
