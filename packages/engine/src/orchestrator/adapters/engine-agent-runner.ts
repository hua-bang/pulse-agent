import type { AgentRunner, AgentRunInput } from '../runner';

/**
 * EngineAgentRunner
 *
 * 将 engine 的工具系统适配为 AgentRunner 接口。
 * engine 层注册的 xxx_agent 工具可以直接被 Orchestrator 驱动。
 *
 * 支持两种构造方式：
 *   // 静态快照
 *   new EngineAgentRunner(context.getTools());
 *   // 惰性获取（推荐，确保拿到最新工具集）
 *   new EngineAgentRunner(() => context.getTools());
 */
export class EngineAgentRunner implements AgentRunner {
  private getTools: () => Record<string, any>;

  constructor(toolsOrGetter: Record<string, any> | (() => Record<string, any>)) {
    if (typeof toolsOrGetter === 'function') {
      this.getTools = toolsOrGetter as () => Record<string, any>;
    } else {
      const snapshot = toolsOrGetter;
      this.getTools = () => snapshot;
    }
  }

  async run(input: AgentRunInput): Promise<string> {
    const tools = this.getTools();
    const tool = tools[input.agentName];
    if (!tool) {
      throw new Error(`Agent tool not found: ${input.agentName}`);
    }
    const output = await tool.execute({ task: input.task, context: input.context });
    return typeof output === 'string' ? output : JSON.stringify(output, null, 2);
  }

  getAvailableAgents(): string[] {
    return Object.keys(this.getTools()).filter(name => name.endsWith('_agent'));
  }
}
