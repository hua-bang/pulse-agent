import { z } from 'zod';
import type { EnginePlugin, EnginePluginContext, SystemPromptOption, Tool } from 'pulse-coder-engine';

import { FileGoalPluginService, type FileGoalServiceOptions } from './service.js';
import type { CompleteGoalInput, Goal, SetGoalInput } from './types.js';

const GOAL_SET_INPUT_SCHEMA = z.object({
  objective: z.string().min(1).describe('The concrete objective to start pursuing. This starts a new active goal, replacing any previous one.'),
  verifyCommand: z.string().optional().describe('Optional shell command the host can run to objectively verify completion.'),
  maxRounds: z.number().int().positive().optional().describe('Optional maximum continuation rounds the host may auto-run for this goal.'),
});

const GOAL_STATUS_INPUT_SCHEMA = z.object({});

const GOAL_CLEAR_INPUT_SCHEMA = z.object({});

const GOAL_COMPLETE_INPUT_SCHEMA = z.object({
  summary: z.string().min(1).describe('Summary of what was done to meet the goal.'),
  evidence: z
    .array(z.string())
    .optional()
    .describe('Concrete, checkable evidence: files changed, commands run and their outputs, verification results. Do not claim completion without evidence.'),
});

const GOAL_PROMPT_SECTION_HEADER = '## Active Goal (Goal Plugin)';

export interface CreateGoalEnginePluginOptions {
  service: FileGoalPluginService;
  name?: string;
  version?: string;
}

export interface CreateGoalIntegrationOptions extends FileGoalServiceOptions {
  service?: FileGoalPluginService;
  pluginName?: string;
  pluginVersion?: string;
}

export interface GoalIntegration {
  service: FileGoalPluginService;
  enginePlugin: EnginePlugin;
  initialize(): Promise<void>;
}

export function createGoalIntegration(options: CreateGoalIntegrationOptions = {}): GoalIntegration {
  const { service, pluginName, pluginVersion, ...serviceOptions } = options;
  const goalService = service ?? new FileGoalPluginService(serviceOptions);

  return {
    service: goalService,
    enginePlugin: createGoalEnginePlugin({
      service: goalService,
      name: pluginName,
      version: pluginVersion,
    }),
    initialize: () => goalService.initialize(),
  };
}

/**
 * Goal engine plugin:
 * - Injects the active goal into the system prompt before every LLM call so a
 *   model keeps working toward it instead of stopping early.
 * - Registers goal_set / goal_status / goal_clear / goal_complete tools so the
 *   model can manage and declare completion in a structured way.
 *
 * The engine loop is NOT modified: goal prompt injection rides the
 * beforeLLMCall hook, and the host decides what to do after a run based on the
 * goal service state.
 */
export function createGoalEnginePlugin(options: CreateGoalEnginePluginOptions): EnginePlugin {
  const pluginName = options.name ?? 'goal-plugin';
  const pluginVersion = options.version ?? '0.0.1';

  return {
    name: pluginName,
    version: pluginVersion,

    async initialize(context: EnginePluginContext): Promise<void> {
      context.registerService('goalService', options.service);

      context.registerTools({
        goal_set: buildGoalSetTool(options.service),
        goal_status: buildGoalStatusTool(options.service),
        goal_clear: buildGoalClearTool(options.service),
        goal_complete: buildGoalCompleteTool(options.service),
      });

      context.registerHook('beforeLLMCall', async ({ systemPrompt }) => {
        const goal = await options.service.getGoal();
        if (!goal || goal.status !== 'active') {
          return;
        }

        const append = buildGoalPromptAppend(goal);
        return { systemPrompt: appendSystemPrompt(systemPrompt, append) };
      });

      context.logger.info('[GoalPlugin] Goal plugin initialized', {
        scope: options.service.scope,
        storagePath: options.service.storagePath,
      });
    },
  };
}

function buildGoalSetTool(service: FileGoalPluginService): Tool {
  return {
    name: 'goal_set',
    description: 'Set a new active goal. The agent keeps working until the goal is met. Use when the user defines an objective that should drive continued autonomous work.',
    inputSchema: GOAL_SET_INPUT_SCHEMA,
    execute: async (input: SetGoalInput) => {
      const goal = await service.setGoal(input);
      return {
        goalId: goal.id,
        objective: goal.objective,
        status: goal.status,
        maxRounds: goal.maxRounds ?? null,
        storagePath: service.storagePath,
      };
    },
  };
}

function buildGoalStatusTool(service: FileGoalPluginService): Tool {
  return {
    name: 'goal_status',
    description: 'Get the current goal for this scope, including status, rounds used, and remaining progress. Use when asked about progress or to re-check whether the goal is still active.',
    inputSchema: GOAL_STATUS_INPUT_SCHEMA,
    execute: async () => {
      const snapshot = await service.snapshot();
      return {
        status: snapshot.status,
        objective: snapshot.objective ?? null,
        verifyCommand: snapshot.verifyCommand ?? null,
        maxRounds: snapshot.maxRounds ?? null,
        roundsUsed: snapshot.roundsUsed,
        completedAt: snapshot.completedAt ?? null,
        completedSummary: snapshot.completedSummary ?? null,
        lastProgress: snapshot.lastProgress ?? null,
        storagePath: snapshot.storagePath,
      };
    },
  };
}

function buildGoalClearTool(service: FileGoalPluginService): Tool {
  return {
    name: 'goal_clear',
    description: 'Clear the active goal. Use when the user says to stop working toward the goal, or when the goal is no longer relevant.',
    inputSchema: GOAL_CLEAR_INPUT_SCHEMA,
    execute: async () => {
      const cleared = await service.clearGoal();
      return { cleared, storagePath: service.storagePath };
    },
  };
}

function buildGoalCompleteTool(service: FileGoalPluginService): Tool {
  return {
    name: 'goal_complete',
    description: 'Declare the active goal complete with a summary and concrete evidence (files changed, commands run and their outputs, verification results). Do not call this without evidence that the objective is met.',
    inputSchema: GOAL_COMPLETE_INPUT_SCHEMA,
    execute: async (input: CompleteGoalInput) => {
      const goal = await service.completeGoal(input);
      return {
        completed: !!goal && goal.status === 'completed',
        goalId: goal?.id ?? null,
        summary: goal?.completedSummary ?? null,
        storagePath: service.storagePath,
      };
    },
  };
}

function buildGoalPromptAppend(goal: Goal): string {
  // Only STABLE fields ride the system prompt. roundsUsed / lastProgress are
  // deliberately excluded: they change on every continuation round, and the
  // system prompt is the prefix of every request — a per-round change would
  // miss the provider's prefix cache on EVERY call (Anthropic cacheControl is
  // applied to the whole system string; OpenAI-compatible auto-cache matches
  // from byte 0). Dynamic state travels in the continuation user message
  // instead (see the CLI host's decideGoalContinuation).
  const lines: string[] = [
    GOAL_PROMPT_SECTION_HEADER,
    `Objective: ${goal.objective}`,
    'Status: active',
  ];

  if (goal.verifyCommand) {
    lines.push(`Host verification command: ${goal.verifyCommand}`);
  }

  lines.push(
    '',
    'Keep working toward this goal. Do not stop early — continue calling tools until the objective is met.',
    'When you believe the goal is complete, call `goal_complete` with a summary and concrete evidence.',
    'Do not call `goal_complete` without evidence that the objective is actually met.',
    'You can check current progress and round usage with `goal_status`.',
  );

  return lines.join('\n');
}

export function appendSystemPrompt(base: SystemPromptOption | undefined, append: string): SystemPromptOption {
  if (!append.trim()) {
    return base ?? { append: '' };
  }

  if (!base) {
    return { append };
  }

  if (typeof base === 'string') {
    return `${base}\n\n${append}`;
  }

  if (typeof base === 'function') {
    return () => `${base()}\n\n${append}`;
  }

  const currentAppend = base.append.trim();
  return {
    append: currentAppend ? `${currentAppend}\n\n${append}` : append,
  };
}
