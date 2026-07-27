import { BrowserWindow, Notification } from 'electron';
import { getCanvasAgentService } from '../agent/ipc';
import type { ScheduledTask } from '../../shared/scheduled';
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

async function executeScheduledTask(task: ScheduledTask): Promise<{ sessionId?: string }> {
  const agentService = getCanvasAgentService();
  const scope = { kind: 'scheduled' as const, taskId: task.id };
  const result = await agentService.chatWithScope(scope, taskRunPrompt(task));
  if (!result.ok) throw new Error(result.error ?? 'Scheduled task failed');
  const sessionId = await agentService.resolveCurrentSessionId(scope);

  if (Notification.isSupported()) {
    const notification = new Notification({
      title: task.title,
      body: 'Scheduled task completed. Click to continue in Chat.',
    });
    notification.on('click', () => openScheduledTask(task.id));
    notification.show();
  }

  return { sessionId: sessionId ?? undefined };
}

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
