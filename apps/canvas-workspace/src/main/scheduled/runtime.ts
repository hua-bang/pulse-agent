import { BrowserWindow } from 'electron';
import { getCanvasAgentService } from '../agent/ipc';
import type {
  ScheduledRunFinished,
  ScheduledTask,
  ScheduledTaskExecutionContext,
} from '../../shared/scheduled';
import { describeSchedule } from '../../shared/scheduled';
import { ScheduledTaskService } from './scheduled-task-service';

let service: ScheduledTaskService | null = null;

const scheduledScope = (taskId: string) => ({ kind: 'scheduled' as const, taskId });

async function createScheduledSession(
  agentService: ReturnType<typeof getCanvasAgentService>,
  taskId: string,
): Promise<string> {
  const created = await agentService.newSessionForScope(scheduledScope(taskId));
  if (!created.ok) throw new Error(created.error ?? 'Could not create scheduled run session');
  return created.activeSessionId;
}

const taskRunPrompt = (task: ScheduledTask): string => [
  `Scheduled task: ${task.title}`,
  `Task ID: ${task.id}`,
  `Cadence: ${describeSchedule(task.schedule)}`,
  '',
  task.prompt,
  '',
  'Unattended scheduled run. Shell commands are available, but nobody is watching — avoid anything '
    + 'destructive. If required context is unavailable, say what is missing instead of asking a clarifying question.',
].join('\n');

/**
 * Announces a finished attempt to the renderer, which raises a sticky toast.
 *
 * In-app only, by decision: an OS notification is the unreliable channel
 * (Focus modes, missing notification daemons, unsigned dev builds and — with
 * no AppUserModelID — Windows all drop it silently), and it duplicated a
 * signal the app can deliver itself. Broadcasting to every window is correct:
 * only windows running the app renderer have a listener, and today the app
 * opens exactly one (the Google-auth popup carries no preload, so it ignores
 * this).
 */
function announceRunFinished(outcome: ScheduledRunFinished): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('scheduled:run-finished', outcome);
  }
}

async function executeScheduledTask(
  task: ScheduledTask,
  context: ScheduledTaskExecutionContext,
): Promise<{ sessionId?: string }> {
  const agentService = getCanvasAgentService();
  const scope = scheduledScope(task.id);
  let sessionId = context.sessionId;
  try {
    // Timer-driven runs have no renderer to prepare a conversation. Give every
    // attempt a durable session before invoking the model, while manual runs
    // reuse the session the visible Scheduled page just opened.
    if (!sessionId) {
      sessionId = await createScheduledSession(agentService, task.id);
    }
    const result = await agentService.chatWithScope(
      scope,
      taskRunPrompt(task),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { expectedConversationSessionId: sessionId },
    );
    if (!result.ok) throw new Error(result.error ?? 'Scheduled task failed');
    announceRunFinished({
      taskId: task.id,
      title: task.title,
      ok: true,
      sessionId,
      trigger: context.trigger,
    });
    return { sessionId };
  } catch (error) {
    // A failed run used to be announced nowhere: the throw happened before
    // the announcement, leaving `lastError` in the list as the only trace.
    announceRunFinished({
      taskId: task.id,
      title: task.title,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      ...(sessionId ? { sessionId } : {}),
      trigger: context.trigger,
    });
    throw error;
  }
}

/** Main-owned manual start: validate task, create its session, then launch. */
export async function startManualScheduledTask(
  taskId: string,
): Promise<{ task: ScheduledTask; sessionId: string }> {
  const scheduled = getScheduledTaskService();
  return scheduled.startTaskNow(
    taskId,
    () => createScheduledSession(getCanvasAgentService(), taskId),
  );
}

export const __testing = { executeScheduledTask };

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
