import type { Context, TaskListService } from 'pulse-coder-engine';
import type { PulseAgent } from 'pulse-coder-engine';
import { formatModelSpec, resolveKnownModelSpec, type ModelChoice } from '../models/model-spec.js';
import { loadModelRegistry } from '../models/model-registry.js';
import type { SessionCommands } from '../commands/session-commands.js';
import type { InputManager } from '../shared/input-manager.js';
import type { SkillCommands } from '../commands/skill-commands.js';
import type { TuiRenderer } from './tui-renderer.js';

/** The readline host's collaborators, shared by its command/turn modules. */
export interface ReadlineHost {
  readonly agent: PulseAgent;
  readonly context: Context;
  readonly sessionCommands: SessionCommands;
  readonly inputManager: InputManager;
  readonly skillCommands: SkillCommands;
  readonly tui: TuiRenderer;
  modelChoice: ModelChoice | null;
  readonly modelSpec?: string;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function estimateTokens(messages: Context['messages']): number {
  let totalChars = 0;

  for (const message of messages) {
    totalChars += message.role.length;
    if (typeof message.content === 'string') {
      totalChars += message.content.length;
    } else {
      totalChars += safeStringify(message.content).length;
    }
  }

  return Math.ceil(totalChars / 4);
}

export function getKeepLastTurns(): number {
  const value = Number(process.env.KEEP_LAST_TURNS ?? 4);
  if (!Number.isFinite(value) || value <= 0) {
    return 4;
  }

  return Math.floor(value);
}

export function resolveCurrentSessionId(host: ReadlineHost): string | null {
  const currentId = host.sessionCommands.getCurrentSessionId();
  if (currentId) {
    return currentId;
  }

  host.tui.warn('No active session ID; memory tools and daily logs are skipped for this run.');
  return null;
}

export async function syncSessionTaskListBinding(host: ReadlineHost): Promise<void> {
  const taskListId = host.sessionCommands.getCurrentTaskListId();
  if (!taskListId) {
    return;
  }

  process.env.PULSE_CODER_TASK_LIST_ID = taskListId;

  const service = host.agent.getService<TaskListService>('taskListService');
  if (!service?.setTaskListId) {
    return;
  }

  try {
    const result = await service.setTaskListId(taskListId);
    if (result.switched) {
      host.tui.success(`Switched task list to ${result.taskListId}`);
    }
  } catch (error: any) {
    host.tui.warn(`Failed to switch task list binding: ${error?.message ?? String(error)}`);
  }
}


/**
 * Applies the model recorded in the just-loaded session (see the Ink host's
 * restoreSessionModel). A --model flag pins the process and wins; an
 * unresolvable spec warns and keeps the current model.
 */
export async function restoreSessionModel(host: ReadlineHost): Promise<void> {
  const spec = host.sessionCommands.getLoadedModelSpec();
  if (!spec || host.modelSpec) {
    return;
  }
  if (host.modelChoice && formatModelSpec(host.modelChoice) === spec) {
    return;
  }

  const registry = await loadModelRegistry();
  const restored = resolveKnownModelSpec(spec, registry);
  if (!restored) {
    host.tui.warn(`Session model "${spec}" is no longer in models.json — keeping the current model`);
    return;
  }

  host.modelChoice = restored;
  host.tui.info(`Model restored from session: ${formatModelSpec(restored)}`);
}
