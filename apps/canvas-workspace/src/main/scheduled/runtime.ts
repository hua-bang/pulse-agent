import { BrowserWindow } from 'electron';
import { getCanvasAgentService } from '../agent/ipc';
import { chatToSubscribers, getConversationRuntimeService } from '../agent/conversation-runtime/conversation-ipc';
import type {
  ScheduledRunFinished,
  ScheduledTask,
  ScheduledTaskExecutionContext,
  ScheduledTaskExecutionResult,
} from '../../shared/scheduled';
import { describeSchedule, isBuiltInDigestSource } from '../../shared/scheduled';
import { ScheduledTaskService } from './scheduled-task-service';
import { collectCanvasActivity, formatActivityBrief } from './activity-collector';
import {
  buildDigestPrompt,
  collectExistingMemoryBlocks,
  digestDaysForSource,
  persistDigestArtifact,
} from './digest-runner';

let service: ScheduledTaskService | null = null;

const scheduledScope = (taskId: string) => ({ kind: 'scheduled' as const, taskId });

const conversationRuntime = () => getConversationRuntimeService(getCanvasAgentService);

async function createScheduledSession(
  agentService: Awaited<ReturnType<typeof getCanvasAgentService>>,
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

function extractFinalAssistantText(result: {
  response?: string;
  assistantMessages?: Array<{ role?: string; content?: string }>;
}): string {
  if (typeof result.response === 'string' && result.response.trim().length > 0) {
    return result.response;
  }
  const messages = result.assistantMessages ?? [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const content = messages[i]?.content;
    if (typeof content === 'string' && content.trim().length > 0) return content;
  }
  return '';
}

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
): Promise<ScheduledTaskExecutionResult> {
  const isDigest = isBuiltInDigestSource(task.source);
  let sessionId = context.sessionId;
  try {
    let prompt: string;
    let summary: string | undefined;

    if (isDigest) {
      const days = digestDaysForSource(task.source);
      const snapshot = await collectCanvasActivity({ days });
      if (context.trigger === 'schedule' && !snapshot.hasActivity) {
        announceRunFinished({
          taskId: task.id,
          title: task.title,
          ok: true,
          skipped: true,
          trigger: context.trigger,
        });
        return { skipped: true };
      }
      summary = formatActivityBrief(snapshot);
      const existingMemoryBlocks = task.source === 'memory-report'
        ? await collectExistingMemoryBlocks()
        : [];
      prompt = buildDigestPrompt({ task, snapshot, existingMemoryBlocks });
    } else {
      prompt = taskRunPrompt(task);
    }

    const agentService = await getCanvasAgentService();
    const scope = scheduledScope(task.id);
    // Timer-driven runs have no renderer to prepare a conversation. Give every
    // attempt a durable session before invoking the model, while manual runs
    // reuse the session the visible Scheduled page just opened.
    if (!sessionId) {
      sessionId = await createScheduledSession(agentService, task.id);
    }
    // The conversation runtime owns the turn, the same path a typed message
    // takes: the live reply is kept for windows that attach mid-run, streamed
    // to them, and checkpointed, so an open chat never shows a running run as
    // interrupted.
    const result = await chatToSubscribers(conversationRuntime(), scope, sessionId, prompt);
    if (!result.ok) throw new Error(result.error ?? 'Scheduled task failed');

    let artifactId: string | undefined;
    if (isDigest) {
      const rawOutput = extractFinalAssistantText(result);
      if (rawOutput) {
        try {
          artifactId = await persistDigestArtifact({
            source: task.source,
            rawOutput,
          });
        } catch (err) {
          console.warn('[scheduled] digest artifact persistence failed:', err);
        }
      }
    }

    announceRunFinished({
      taskId: task.id,
      title: task.title,
      ok: true,
      sessionId,
      ...(artifactId ? { artifactId } : {}),
      ...(summary ? { summary } : {}),
      trigger: context.trigger,
    });
    return {
      sessionId,
      ...(artifactId ? { artifactId } : {}),
      ...(summary ? { summary } : {}),
    };
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

/**
 * Creates a manual run's session and opens the scope's conversation runtime
 * before the id goes back. The Scheduled page opens the chat at once, and
 * its attach finds the turn only once the run is live; a cold scope would
 * otherwise still be activating and the chat would miss the whole run.
 */
async function prepareManualSession(taskId: string): Promise<string> {
  const sessionId = await createScheduledSession(await getCanvasAgentService(), taskId);
  await conversationRuntime().hasSession(scheduledScope(taskId), sessionId);
  return sessionId;
}

/** Main-owned manual start: validate task, create its session, then launch. */
export async function startManualScheduledTask(
  taskId: string,
): Promise<{ task: ScheduledTask; sessionId: string }> {
  const scheduled = getScheduledTaskService();
  return scheduled.startTaskNow(taskId, () => prepareManualSession(taskId));
}

export const __testing = { executeScheduledTask, prepareManualSession };

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
