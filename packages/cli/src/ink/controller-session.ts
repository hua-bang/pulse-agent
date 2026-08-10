import type { Context, TaskListService } from 'pulse-coder-engine';
import type { FileGoalPluginService } from 'pulse-coder-plugin-kit/goal';
import type { InkCoderController } from './ink-controller.js';
import { currentContextWindow } from './controller-model.js';
import { describeCacheHit } from './controller-run.js';
import { goalIntegration } from '../shared/goal-integration.js';

/** Session/task-list plumbing, status publishing, and context-size estimates. */

export async function syncSessionTaskListBinding(controller: InkCoderController): Promise<void> {
  const taskListId = controller.sessionCommands.getCurrentTaskListId();
  if (!taskListId) {
    return;
  }

  process.env.PULSE_CODER_TASK_LIST_ID = taskListId;

  const service = controller.agent.getService<TaskListService>('taskListService');
  if (!service?.setTaskListId) {
    return;
  }

  try {
    const result = await service.setTaskListId(taskListId);
    if (result.switched) {
      controller.ui.success(`Switched task list to ${result.taskListId}`);
    }
  } catch (error: any) {
    controller.ui.warn(`Failed to switch task list binding: ${error?.message ?? String(error)}`);
  }
}

/**
 * Rebinds the goal store to the current session's scope. `/goal` and the
 * continuation loop then target the session's goal, so a resumed session picks
 * up where its goal left off.
 */
export async function syncSessionGoalBinding(controller: InkCoderController): Promise<void> {
  const sessionId = controller.sessionCommands.getCurrentSessionId();
  const scope = sessionId ? `session-${sessionId}` : 'default';

  try {
    const service = controller.agent.getService<FileGoalPluginService>('goalService');
    if (service?.setScope) {
      const result = await service.setScope(scope);
      if (result.switched) {
        controller.ui.info(`Goal scope: ${result.scope}`);
      }
      return;
    }
  } catch (error: any) {
    controller.ui.warn(`Failed to switch goal scope: ${error?.message ?? String(error)}`);
  }

  // Engine plugin unavailable (e.g. hand-assembled host without goal plugin):
  // fall back to the CLI-side singleton so /goal still works.
  await goalIntegration.initialize();
  const result = await goalIntegration.service.setScope(scope);
  if (result.switched) {
    controller.ui.info(`Goal scope: ${result.scope}`);
  }
}

export function resolveCurrentSessionId(controller: InkCoderController): string | null {
  const currentId = controller.sessionCommands.getCurrentSessionId();
  if (currentId) {
    return currentId;
  }

  controller.ui.warn('No active session ID; memory tools and daily logs are skipped for this run.');
  return null;
}

export function publishSession(controller: InkCoderController, status: string): void {
  controller.ui.updateSnapshot({
    sessionId: controller.sessionCommands.getCurrentSessionId(),
    taskListId: controller.sessionCommands.getCurrentTaskListId(),
    messages: controller.context.messages.length,
    estimatedTokens: estimateTokens(controller, controller.context.messages),
    mode: controller.interactionMode,
    queuedInputs: controller.queuedInputs.length,
    isProcessing: controller.isProcessing,
    status,
    ...(status === 'Ready' && !controller.isProcessing ? { phase: 'Idle', activeTool: null } : {}),
  });
}

export function estimateTokens(controller: InkCoderController, messages: Context['messages']): number {
  let totalChars = 0;

  for (const message of messages) {
    totalChars += message.role.length;
    if (typeof message.content === 'string') {
      totalChars += message.content.length;
    } else {
      totalChars += safeStringify(controller, message.content).length;
    }
  }

  return Math.ceil(totalChars / 4);
}

export function safeStringify(controller: InkCoderController, value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function getKeepLastTurns(controller: InkCoderController): number {
  const value = Number(process.env.KEEP_LAST_TURNS ?? 4);
  if (!Number.isFinite(value) || value <= 0) {
    return 4;
  }

  return Math.floor(value);
}

/** Usage counters are per-conversation; /new, /clear and /resume must zero them. */
export function resetUsageCounters(controller: InkCoderController): void {
  controller.lastContextTokens = 0;
  controller.totalOutputTokens = 0;
  controller.lastCachedTokens = undefined;
  controller.totalInputTokens = 0;
  controller.totalCachedTokens = 0;
  controller.ui.resetUsage();
}
