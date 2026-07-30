import { BrowserWindow } from 'electron';
import { getCanvasAgentService } from '../agent/ipc';
import type { ScheduledRunFinished, ScheduledRunProgress, ScheduledTask } from '../../shared/scheduled';
import { describeSchedule } from '../../shared/scheduled';
import {
  beginRun,
  endRun,
  noteText,
  noteToolCall,
  noteToolResult,
  requestCancel,
  snapshot,
  wasCancelRequested,
} from './run-progress';
import { ScheduledTaskService } from './scheduled-task-service';

let service: ScheduledTaskService | null = null;

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

async function executeScheduledTask(task: ScheduledTask): Promise<{ sessionId?: string }> {
  const agentService = getCanvasAgentService();
  const scope = { kind: 'scheduled' as const, taskId: task.id };
  beginRun(task.id);
  try {
    // The stream callbacks are the whole reason the task's conversation can
    // show what a background run is doing. Passing none — the original shape
    // of this call — makes buildEngineStreamCallbacks drop every chunk.
    const result = await agentService.chatWithScope(
      scope,
      taskRunPrompt(task),
      () => noteText(task.id),
      (call) => noteToolCall(task.id, call.name, call.toolCallId),
      (toolResult) => noteToolResult(task.id, toolResult.name, toolResult.toolCallId),
    );
    if (!result.ok) throw new Error(result.error ?? 'Scheduled task failed');
    const sessionId = await agentService.resolveCurrentSessionId(scope);
    announceRunFinished({ taskId: task.id, title: task.title, ok: true });
    return { sessionId: sessionId ?? undefined };
  } catch (error) {
    // A failed run used to be announced nowhere: the throw happened before
    // the announcement, leaving `lastError` in the list as the only trace.
    // A user-stopped run reports through the same channel but is flagged, so
    // the renderer can keep an intentional stop out of the error tone.
    const cancelled = wasCancelRequested(task.id);
    announceRunFinished({
      taskId: task.id,
      title: task.title,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      ...(cancelled ? { cancelled: true } : {}),
    });
    throw error;
  } finally {
    endRun(task.id);
  }
}

/**
 * Stop a task's in-flight run. The abort surfaces as a failed attempt (the
 * engine throws), which is honest — the slot was consumed and produced no
 * result — but `requestCancel` marks it so the announcement carries
 * `cancelled` and the UI does not cry error over a deliberate stop.
 */
export function cancelScheduledRun(taskId: string): { ok: boolean; error?: string } {
  if (!requestCancel(taskId)) return { ok: false, error: 'No scheduled run in flight' };
  getCanvasAgentService().abortScope({ kind: 'scheduled', taskId });
  return { ok: true };
}

export function getScheduledRunProgress(taskId: string): ScheduledRunProgress | undefined {
  return snapshot(taskId);
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
