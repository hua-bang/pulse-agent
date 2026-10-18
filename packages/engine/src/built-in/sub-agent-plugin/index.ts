import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';
import type { EnginePlugin, EnginePluginContext } from '../../plugin/EnginePlugin';
import type { Context } from '../../shared/types.js';
import type { Tool, ToolExecutionContext } from '../../shared/types';
import { AGENT_BASE_RULES } from '../../prompt/agent-base';

const DEFAULT_SUB_AGENT_MAX_STEPS = 30;

interface AgentConfig {
  name: string;
  description: string;
  systemPrompt: string;
  filePath: string;
  deferLoading?: boolean;
}

class ConfigLoader {

  async getAgentFilesInfo(configDirs: string[]) {
    const fileInfos: Array<{ files: string[], configDir: string }> = [];
    for (let configDir of configDirs) {
      try {
        await fs.access(configDir);

        const files = await fs.readdir(configDir);
        fileInfos.push({ files, configDir });
      } catch {
        continue;
      }
    }

    return fileInfos;
  }

  async loadAgentConfigs(configDir: string | string[] = ['.pulse-coder/agents', '.coder/agents']): Promise<AgentConfig[]> {
    const configs: AgentConfig[] = [];

    const configDirs = Array.isArray(configDir) ? configDir : [configDir];

    try {
      const filesInfo = await this.getAgentFilesInfo(configDirs);

      for (const fileInfo of filesInfo) {
        const files = fileInfo.files;
        for (const file of files) {
          if (file.endsWith('.md')) {
            const config = await this.parseConfig(path.join(fileInfo.configDir, file));
            if (config) configs.push(config);
          }
        }
      }
    } catch (error) {
      console.warn(`Failed to scan agent configs: ${error}`);
    }

    return configs;
  }

  private async parseConfig(filePath: string): Promise<AgentConfig | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');

      let name = '';
      let description = '';
      let systemPrompt = '';
      let deferLoading: boolean | undefined;
      let inFrontmatter = false;
      let frontmatterEnd = false;

      for (const line of lines) {
        if (line.trim() === '---') {
          if (!inFrontmatter) {
            inFrontmatter = true;
            continue;
          } else {
            frontmatterEnd = true;
            continue;
          }
        }

        if (inFrontmatter && !frontmatterEnd) {
          const match = line.match(/^\s*(\w+)\s*:\s*(.+)$/);
          if (match) {
            const [, key, value] = match;
            const normalizedValue = value.trim();
            if (key === 'name') name = normalizedValue;
            if (key === 'description') description = normalizedValue;
            if (key === 'defer_loading' || key === 'deferLoading') {
              if (normalizedValue === 'true') deferLoading = true;
              if (normalizedValue === 'false') deferLoading = false;
            }
          }
        } else if (frontmatterEnd) {
          systemPrompt += line + '\n';
        }
      }

      if (!name) {
        name = path.basename(filePath, '.md');
      }

      return {
        name: name.trim(),
        description: description.trim(),
        systemPrompt: systemPrompt.trim(),
        filePath,
        deferLoading,
      };
    } catch (error) {
      console.warn(`Failed to parse agent config ${filePath}: ${error}`);
      return null;
    }
  }
}

/**
 * Sub-agent tools never reach other sub-agent tools: one level of delegation,
 * no unbounded recursion.
 */
function childTools(tools: Record<string, Tool>): Record<string, Tool> {
  return Object.fromEntries(Object.entries(tools).filter(([name]) => !name.endsWith('_agent')));
}

function buildTaskMessage(task: string, taskContext?: Record<string, any>): string {
  if (!taskContext || Object.keys(taskContext).length === 0) return task;
  return `${task}\n\nContext:\n${JSON.stringify(taskContext, null, 2)}`;
}

export interface SubAgentPluginOptions {
  /** Directories scanned for agent Markdown files. Defaults to `.pulse-coder/agents` and `.coder/agents`. */
  agentDirs?: string[];
}

export class SubAgentPlugin implements EnginePlugin {
  name = 'sub-agent';
  version = '1.0.0';

  private configLoader = new ConfigLoader();

  constructor(private readonly options: SubAgentPluginOptions = {}) {}

  async initialize(context: EnginePluginContext): Promise<void> {
    try {
      const configs = await this.configLoader.loadAgentConfigs(this.options.agentDirs);

      for (const config of configs) {
        this.registerAgentTool(context, config);
      }

      context.logger.info(`SubAgentPlugin loaded ${configs.length} agents.`);
    } catch (error) {
      context.logger.error('Failed to initialize SubAgentPlugin', error as Error);
    }
  }

  private registerAgentTool(
    context: EnginePluginContext,
    config: AgentConfig
  ): void {
    const toolName = `${config.name}_agent`;

    const tool: Tool = {
      name: toolName,
      description: config.description,
      ...(config.deferLoading === true ? { defer_loading: true } : {}),
      inputSchema: z.object({
        task: z.string().describe('要执行的任务描述'),
        context: z.any().optional().describe('任务上下文信息')
      }),
      execute: async (
        { task, context: taskContext }: { task: string; context?: Record<string, any> },
        executionContext?: ToolExecutionContext,
      ) => {
        const engine = context.getEngineInstance();
        if (!engine.runChild) {
          throw new Error(`Agent ${config.name} requires an Engine host`);
        }
        // The parent run's policy table (host tool selection, beforeRun /
        // beforeLLMCall policy) rather than a rebuilt built-in set.
        const tools = childTools(executionContext?.nestedTools?.getTools() ?? engine.tools);
        const tag = `[agent:${config.name}]`;
        // console, never process.stdout.write: the engine is host-agnostic and
        // hosts own the terminal. Raw stdout bytes tear an Ink host's frame —
        // every foreign write scrolls the screen and strands a stale copy of
        // the live region in scrollback (observed as dozens of duplicated
        // "running tool" lines while parallel sub-agents worked). Hosts
        // capture console.* and route it to their log layer instead.
        const log = (msg: string) => console.log(`${tag} ${msg}`);
        try {
          log(`Running: ${task.slice(0, 80)}${task.length > 80 ? '...' : ''}`);
          const summarizeArgs = (args: any): string => {
            if (!args || typeof args !== 'object') return '';
            // Show the most informative field for common tools
            const hint = args.file_path ?? args.path ?? args.pattern ?? args.command ?? args.query;
            if (typeof hint === 'string') return ` ${hint.length > 60 ? hint.slice(0, 60) + '...' : hint}`;
            return '';
          };

          const subContext: Context = {
            messages: [{ role: 'user', content: buildTaskMessage(task, taskContext) }],
          };
          const result = await engine.runChild(subContext, {
            tools,
            systemPrompt: `${AGENT_BASE_RULES}\n\n${config.systemPrompt}`,
            maxSteps: DEFAULT_SUB_AGENT_MAX_STEPS,
            abortSignal: executionContext?.abortSignal,
            runContext: executionContext?.runContext,
            llm: executionContext?.llm,
            onToolCall: (toolCall) => {
              const name = toolCall?.toolName ?? toolCall?.name ?? 'tool';
              const hint = summarizeArgs(toolCall?.args);
              log(`🔧 ${name}${hint}`);
            },
            onToolResult: (toolResult) => {
              const name = (toolResult as any)?.toolName ?? (toolResult as any)?.name ?? 'tool';
              log(`✅ ${name}`);
            },
          });
          log('Done');
          return result;
        } catch (error) {
          log(`❌ Failed: ${error}`);
          throw new Error(`Agent ${config.name} failed: ${error}`);
        }
      }
    };

    context.registerTool(toolName, tool);
  }

  async destroy(context: EnginePluginContext): Promise<void> {
    context.logger.info('SubAgentPlugin destroyed');
  }
}

export default SubAgentPlugin;