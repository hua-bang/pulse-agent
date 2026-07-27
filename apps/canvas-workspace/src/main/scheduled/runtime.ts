import { BrowserWindow, Notification } from 'electron';
import { getCanvasAgentService } from '../agent/ipc';
import type { ScheduledRunFinished, ScheduledTask } from '../../shared/scheduled';
import { describeSchedule } from '../../shared/scheduled';
import { ScheduledTaskService } from './scheduled-task-service';

let service: ScheduledTaskService | null = null;

const taskRunPrompt = (task: ScheduledTask): string => [
  `Scheduled task: ${task.title}`,
  `Task ID: ${task.id}`,
  `Cadence: ${describeSchedule(task.schedule)}`,
  '',
  task.prompt,
  '',
  'This is an unattended scheduled run. Complete the task with the available read-only tools. '
    + 'If required context is unavailable, explain what is missing instead of asking a live clarification question.',
].join('\n');

export function openScheduledTask(taskId: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.webContents.send('scheduled:open-task', taskId);
  }
}

/**
 * Electron collects a Notification that loses its last reference before the
 * OS has displayed it, so a bare `new Notification(...).show()` inside an
 * async function that returns immediately can silently never appear. Hold
 * each one until it resolves — bounded by a timer, because `close` is not
 * guaranteed to fire on every platform and an unbounded set would leak one
 * entry per run forever.
 */
const pendingNotifications = new Set<Notification>();
const NOTIFICATION_HOLD_MS = 60_000;

function showRunNotification(task: ScheduledTask, outcome: ScheduledRunFinished): void {
  if (!Notification.isSupported()) return;
  const notification = new Notification({
    title: task.title,
    body: outcome.ok
      ? 'Scheduled task completed. Click to continue in Chat.'
      : `Scheduled task failed: ${outcome.error ?? 'unknown error'}`,
  });
  pendingNotifications.add(notification);
  const holdTimer = setTimeout(() => pendingNotifications.delete(notification), NOTIFICATION_HOLD_MS);
  holdTimer.unref?.();
  const release = () => {
    clearTimeout(holdTimer);
    pendingNotifications.delete(notification);
  };
  notification.on('click', () => {
    release();
    openScheduledTask(task.id);
  });
  notification.on('close', release);
  notification.on('failed', release);
  notification.show();
}

/**
 * Announces a finished attempt on both channels. The OS notification is not
 * a reliable signal on its own — it is suppressed by Focus modes, missing
 * notification daemons, and unsigned dev builds — so the renderer push is
 * what guarantees the user sees SOMETHING when a run ends.
 */
function announceRunFinished(task: ScheduledTask, outcome: ScheduledRunFinished): void {
  showRunNotification(task, outcome);
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('scheduled:run-finished', outcome);
  }
}

async function executeScheduledTask(task: ScheduledTask): Promise<{ sessionId?: string }> {
  const agentService = getCanvasAgentService();
  const scope = { kind: 'scheduled' as const, taskId: task.id };
  try {
    const result = await agentService.chatWithScope(scope, taskRunPrompt(task));
    if (!result.ok) throw new Error(result.error ?? 'Scheduled task failed');
    const sessionId = await agentService.resolveCurrentSessionId(scope);
    announceRunFinished(task, { taskId: task.id, title: task.title, ok: true });
    return { sessionId: sessionId ?? undefined };
  } catch (error) {
    // A failed run used to be announced nowhere: the throw happened before
    // the notification, leaving `lastError` in the list as the only trace.
    announceRunFinished(task, {
      taskId: task.id,
      title: task.title,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export const __testing = {
  executeScheduledTask,
  pendingNotificationCount: () => pendingNotifications.size,
};

export function getScheduledTaskService(): ScheduledTaskService {
  if (!service) {
    service = new ScheduledTaskService({
      execute: executeScheduledTask,
      onChange: (tasks) => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send('scheduled:changed', tasks);
        }
      },
    });
  }
  return service;
}
