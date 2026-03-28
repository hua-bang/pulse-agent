import { z } from 'zod';

import type { EnginePlugin, EnginePluginContext } from '../../plugin/EnginePlugin';
import type { Tool } from '../../shared/types';
import { generateTextAI } from '../../ai';

import {
  Orchestrator,
  EngineAgentRunner,
} from 'pulse-coder-orchestrator';
import type { OrchestrationInput, OrchestrationResult } from 'pulse-coder-orchestrator';

import { RoleRegistry } from './registry';

/** Zod schema kept identical to the previous version for backward compatibility. */
const TEAM_RUN_INPUT_SCHEMA = z.object({
  task: z.string().describe('要执行的任务描述'),
  context: z.any().optional().describe('任务上下文信息'),
  roles: z.array(z.string()).optional().describe('明确指定的角色列表'),
  graph: z.any().optional().describe('自定义 TaskGraph'),
  route: z.enum(['auto', 'all', 'plan']).optional().describe('auto=关键词路由, all=全角色, plan=LLM动态规划'),
  includeRoles: z.array(z.string()).optional().describe('强制包含的角色'),
  excludeRoles: z.array(z.string()).optional().describe('排除的角色'),
  roleTools: z.record(z.string(), z.string()).optional().describe('角色到工具名称映射'),
  maxConcurrency: z.number().int().min(1).optional().describe('最大并发数'),
  nodeTimeoutMs: z.number().int().min(0).optional().describe('单节点超时'),
  retries: z.number().int().min(0).optional().describe('重试次数'),
  aggregate: z.enum(['concat', 'last']).optional().describe('聚合策略'),
});

type TeamRunInput = z.infer<typeof TEAM_RUN_INPUT_SCHEMA>;

interface TeamRunOutput {
  task: string;
  roles: string[];
  graph: OrchestrationResult['graph'];
  results: OrchestrationResult['results'];
  aggregate: string;
}

export const builtInAgentTeamsPlugin: EnginePlugin = {
  name: 'pulse-coder-engine/built-in-agent-teams',
  version: '1.0.0',
  dependencies: ['sub-agent'],

  async initialize(context: EnginePluginContext): Promise<void> {
    const registry = new RoleRegistry();

    // Lazy getter ensures dynamically registered tools are always visible.
    const runner = new EngineAgentRunner(() => context.getTools());

    // Bridge engine LLM to the orchestrator's llmCall contract.
    const llmCall = async (systemPrompt: string, userPrompt: string): Promise<string> => {
      const result = await generateTextAI(
        [{ role: 'user', content: userPrompt }],
        {},
        { systemPrompt },
      );
      return result.text?.trim() ?? '';
    };

    const orchestrator = new Orchestrator({
      runner,
      llmCall,
      logger: {
        debug: (msg) => context.logger.debug?.(msg),
        info: (msg) => context.logger.info(msg),
        warn: (msg) => context.logger.warn?.(msg),
        error: (msg, err) => context.logger.error(msg, err),
      },
    });

    const tool: Tool<TeamRunInput, TeamRunOutput> = {
      name: 'agent_teams_run',
      description: 'Run a fixed DAG agent team with role routing and aggregation.',
      defer_loading: true,
      inputSchema: TEAM_RUN_INPUT_SCHEMA,
      execute: async (input) => {
        // Map plugin roleTools to orchestrator roleAgents.
        const roleAgents = registry.resolveRoleTools(input.roleTools);

        const orchestrationInput: OrchestrationInput = {
          task: input.task,
          context: input.context,
          roles: input.roles as OrchestrationInput['roles'],
          graph: input.graph,
          route: input.route,
          includeRoles: input.includeRoles as OrchestrationInput['includeRoles'],
          excludeRoles: input.excludeRoles as OrchestrationInput['excludeRoles'],
          roleAgents,
          maxConcurrency: input.maxConcurrency,
          nodeTimeoutMs: input.nodeTimeoutMs,
          retries: input.retries,
          aggregate: input.aggregate,
        };

        const result = await orchestrator.run(orchestrationInput);

        return {
          task: result.task,
          roles: result.roles,
          graph: result.graph,
          results: result.results,
          aggregate: result.aggregate,
        };
      },
    };

    context.registerTool('agent_teams_run', tool);
    context.registerService('agentTeamsRoleRegistry', registry);
    context.logger.info('[AgentTeams] Built-in agent teams plugin initialized (thin adapter)');
  },
};

export default builtInAgentTeamsPlugin;
