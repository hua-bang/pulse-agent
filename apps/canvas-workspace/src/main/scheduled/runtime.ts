import { BrowserWindow } from 'electron';
import { getCanvasAgentService } from '../agent/ipc';
import type { ScheduledRunFinished, ScheduledRunProgress, ScheduledTask } from '../../shared/scheduled';
import { describeSchedule } from '../../shared/scheduled';
import { createRunProgressReporter } from './run-progress';
import { ScheduledTaskService } from './scheduled-task-service';

let service: ScheduledTaskService | null = null;

/** Live progress per in-flight run; entries exist only while a run is going. */
const activeRuns = new Map<string, ScheduledRunProgress>();

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
 * Broadcasting to every window is correct: only windows running the app
 * renderer have a listener, and today the app opens exactly one (the
 * Google-auth popup carries no preload, so it ignores this).
 */
function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

/**
 * Announces a finished attempt to the renderer, which raises a sticky toast.
 *
 * In-app only, by decision: an OS notification is the unreliable channel
 * (Focus modes, missing notification daemons, unsigned dev builds and — with
 * no AppUserModelID — Windows all drop it silently), and it duplicated a
 * signal the app can deliver itself.
 */
function announceRunFinished(outcome: ScheduledRunFinished): void {
  broadcast('scheduled:run-finished', outcome);
}

/** Snapshot for surfaces that mount after a run already started. */
export function activeRunProgress(): ScheduledRunProgress[] {
  return [...activeRuns.values()];
}

async function executeScheduledTask(task: ScheduledTask): Promise<{ sessionId?: string }> {
  const agentService = getCanvasAgentService();
  const scope = { kind: 'scheduled' as const, taskId: task.id };
  // A scheduled run has no renderer driving it, so nothing would otherwise
  // report on a run that takes minutes. Feed the agent's stream callbacks
  // into a progress push instead of dropping them.
  const reporter = createRunProgressReporter({
    taskId: task.id,
    emit: (progress) => {
      activeRuns.set(task.id, progress);
      broadcast('scheduled:run-progress', progress);
    },
  });
  reporter.start();
  try {
    const result = await agentService.chatWithScope(
      scope,
      taskRunPrompt(task),
      () => reporter.onText(),
      (toolCall) => reporter.onToolCall(toolCall.name),
      () => reporter.onToolResult(),
    );
    if (!result.ok) throw new Error(result.error ?? 'Scheduled task failed');
    const sessionId = await agentService.resolveCurrentSessionId(scope);
    announceRunFinished({ taskId: task.id, title: task.title, ok: true });
    return { sessionId: sessionId ?? undefined };
  } catch (error) {
    // A failed run used to be announced nowhere: the throw happened before
    // the announcement, leaving `lastError` in the list as the only trace.
    announceRunFinished({
      taskId: task.id,
      title: task.title,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    // The run is over either way; a stale entry would keep the UI claiming
    // work is still in flight.
    activeRuns.delete(task.id);
  }
}

export const __testing = { executeScheduledTask };

export function getScheduledTaskService(): ScheduledTaskService {
  if (!service) {
    service = new ScheduledTaskService({
      execute: executeScheduledTask,
      onChange: (tasks) => broadcast('scheduled:changed', tasks),
    });
  }
  return service;
}
