import { asSchema } from 'ai';
import type { Context, Tool, ToolExecutionContext, LLMProviderFactory, SystemPromptOption, ToolHooks, ILogger, PulseEngineInstance, ModelType } from './shared/types';
import type { LoopOptions, LoopHooks } from './core/loop';
import type { EnginePluginLoadOptions } from './plugin/EnginePlugin.js';
import type { UserConfigPluginLoadOptions } from './plugin/UserConfigPlugin.js';
import type { PlanMode, PlanModeService } from './built-in/index.js';

import { loop } from './core/loop.js';
import { maybeCompactContext } from './context/index.js';
import { BuiltinToolsMap } from './tools/index.js';

export interface EngineToolSession {
  /** Current policy-filtered tools visible to the external model harness. */
  getTools(): Record<string, Tool>;
  /** Execute a currently visible tool and advance per-step policy state. */
  executeTool(name: string, input: unknown, toolContext?: ToolExecutionContext): Promise<unknown>;
  /** Close outstanding model/plugin lifecycle hooks. Idempotent. */
  dispose(result?: string): Promise<void>;
}
import { PluginManager } from './plugin/PluginManager.js';
import { builtInPlugins } from './built-in/index.js';
import { buildProvider } from './config/index.js';

/**
 * 引擎配置选项
 */
export interface EngineOptions {
  // 引擎插件配置
  enginePlugins?: EnginePluginLoadOptions;

  // 用户配置插件配置
  userConfigPlugins?: UserConfigPluginLoadOptions;

  // 是否禁用内置插件（默认启用）
  disableBuiltInPlugins?: boolean;

  /**
   * Host-selected built-in tool set. Omit to use every engine built-in tool.
   * Passing an empty object disables built-in tools while preserving plugin
   * tools and the higher-priority `tools` layer.
   *
   * This is intentionally a replacement rather than a blocklist: hosts with a
   * narrower trust boundary can opt in only the capabilities they reviewed.
   */
  builtInTools?: Record<string, Tool>;

  // 全局配置
  config?: Record<string, any>;

  /**
   * 自定义 LLM Provider。
   * 接收模型名称，返回 Vercel AI SDK LanguageModel 实例。
   * 未设置时使用环境变量配置的默认 Provider（OpenAI / Anthropic）。
   *
   * @example
   * import { createOpenAI } from '@ai-sdk/openai';
   * const engine = new Engine({
   *   llmProvider: createOpenAI({ apiKey: 'sk-...', baseURL: 'https://my-proxy/v1' }).chat,
   *   model: 'gpt-4o',
   * });
   */
  llmProvider?: LLMProviderFactory;

  /**
   * Named provider type. Convenience alternative to `llmProvider` — engine will construct
   * the SDK adapter from environment variables automatically.
   * Ignored when `llmProvider` is set explicitly.
   * - `'openai'` → OPENAI_API_KEY / OPENAI_API_URL
   * - `'claude'` → ANTHROPIC_API_KEY / ANTHROPIC_API_URL
   */
  modelType?: ModelType;

  /**
   * 模型名称，传递给 llmProvider。未设置时使用 DEFAULT_MODEL。
   */
  model?: string;

  /**
   * 直接注册自定义工具，无需创建 EnginePlugin。
   * 这些工具会与内置工具以及插件注册的工具合并。
   * 若与内置工具同名，自定义工具优先级更高。
   *
   * @example
   * import { z } from 'zod';
   * const engine = new Engine({
   *   tools: {
   *     myTool: {
   *       name: 'myTool',
   *       description: '查询内部数据库',
   *       inputSchema: z.object({ query: z.string() }),
   *       execute: async ({ query }) => fetchFromDB(query),
   *     },
   *   },
   * });
   */
  tools?: Record<string, Tool>;

  /**
   * 自定义 System Prompt，三种形式：
   * - `string` — 完全替换内置 prompt
   * - `() => string` — 工厂函数，每次请求调用（支持动态 prompt）
   * - `{ append: string }` — 在内置 prompt 末尾追加业务上下文
   *
   * @example
   * const engine = new Engine({
   *   systemPrompt: { append: '公司规范：所有变量使用 camelCase。禁止使用 any 类型。' },
   * });
   */
  systemPrompt?: SystemPromptOption;

  /**
   * Tool 执行钩子，在每次工具调用前/后触发。
   * - `onBeforeToolCall` 可以修改入参，或抛错来拦截调用。
   * - `onAfterToolCall` 可以修改返回值（如脱敏、截断）。
   *
   * Backward-compatible shorthand — internally converted to
   * beforeToolCall / afterToolCall engine hooks.
   *
   * @example
   * const engine = new Engine({
   *   hooks: {
   *     onBeforeToolCall: (name, input) => {
   *       if (name === 'bash') throw new Error('bash 工具已被禁用');
   *     },
   *     onAfterToolCall: (name, input, output) => {
   *       auditLogger.log({ name, input, output });
   *       return output;
   *     },
   *   },
   * });
   */
  hooks?: ToolHooks;

  /**
   * 自定义日志实现。未设置时使用 console.*。
   * 兼容 winston / pino 等主流日志库。
   *
   * @example
   * import pino from 'pino';
   * const logger = pino();
   * const engine = new Engine({ logger });
   */
  logger?: ILogger;
}

/**
 * 重构后的引擎类
 * 自动包含内置插件，支持可选禁用
 */
export class Engine {
  private pluginManager: PluginManager;
  private tools: Record<string, any>;
  private options: EngineOptions = {};
  private config: Record<string, any> = {};

  get instance(): PulseEngineInstance {
    return {
      tools: this.tools,
    };
  }

  constructor(options?: EngineOptions) {
    this.tools = { ...(options?.builtInTools ?? BuiltinToolsMap) };
    this.pluginManager = new PluginManager(() => this.instance, options?.logger);

    // 初始化全局配置
    this.config = options?.config || {};
    this.options = options || {};
  }



  /**
   * 初始化引擎和插件系统
   * 自动包含内置插件
   */
  async initialize(): Promise<void> {
    const log = this.options.logger ?? console;
    log.info('Initializing engine...');

    // 准备插件列表：内置插件 + 用户配置插件
    const allEnginePlugins = this.prepareEnginePlugins();

    // 插件管理器会自动处理加载顺序
    await this.pluginManager.initialize({
      enginePlugins: {
        ...allEnginePlugins
      },
      userConfigPlugins: {
        ...(this.options.userConfigPlugins || {})
      }
    });

    // 合并插件工具到引擎工具库
    const pluginTools = this.pluginManager.getTools();
    this.tools = { ...this.tools, ...pluginTools };

    // 合并业务方直接传入的自定义工具（优先级最高，可覆盖内置工具）
    if (this.options.tools) {
      this.tools = { ...this.tools, ...this.options.tools };
    }
  }

  /**
   * 准备引擎插件列表（包含内置插件）
   */
  private prepareEnginePlugins(): EnginePluginLoadOptions {
    const userPlugins = this.options.enginePlugins || {};

    // 如果用户禁用了内置插件，只返回用户插件
    if (this.options.disableBuiltInPlugins) {
      return userPlugins;
    }

    // 合并内置插件和用户插件
    const builtInPluginList = [...builtInPlugins];
    const userPluginList = userPlugins.plugins || [];

    return {
      plugins: [...builtInPluginList, ...userPluginList],
      dirs: userPlugins.dirs || ['.pulse-coder/engine-plugins', '.coder/engine-plugins', '~/.pulse-coder/engine-plugins', '~/.coder/engine-plugins'],
      scan: userPlugins.scan !== false // 默认启用扫描
    };
  }

  /**
   * Collect all hooks for a given loop invocation.
   * Merges plugin hooks with the legacy EngineOptions.hooks (ToolHooks).
   */
  private collectLoopHooks(): LoopHooks {
    const loopHooks: LoopHooks = {
      beforeLLMCall: this.pluginManager.getHooks('beforeLLMCall'),
      afterLLMCall: this.pluginManager.getHooks('afterLLMCall'),
      beforeToolCall: [...this.pluginManager.getHooks('beforeToolCall')],
      afterToolCall: [...this.pluginManager.getHooks('afterToolCall')],
      onToolCall: this.pluginManager.getHooks('onToolCall'),
      onCompacted: this.pluginManager.getHooks('onCompacted'),
    };

    // Convert legacy EngineOptions.hooks (ToolHooks) to hook entries
    const legacyHooks = this.options.hooks;
    if (legacyHooks?.onBeforeToolCall) {
      const legacyBefore = legacyHooks.onBeforeToolCall;
      loopHooks.beforeToolCall!.push(async ({ name, input }) => {
        const modified = await legacyBefore(name, input);
        return modified !== undefined ? { input: modified } : undefined;
      });
    }
    if (legacyHooks?.onAfterToolCall) {
      const legacyAfter = legacyHooks.onAfterToolCall;
      loopHooks.afterToolCall!.push(async ({ name, input, output }) => {
        const modified = await legacyAfter(name, input, output);
        return modified !== undefined ? { output: modified } : undefined;
      });
    }

    return loopHooks;
  }

  /**
   * 运行AI循环
   */
  async run(context: Context, options?: LoopOptions): Promise<string> {
    let systemPrompt = options?.systemPrompt ?? this.options.systemPrompt;
    let tools = { ...this.tools };

    // --- beforeRun hooks ---
    const beforeRunHooks = this.pluginManager.getHooks('beforeRun');
    for (const hook of beforeRunHooks) {
      const result = await hook({ context, systemPrompt, tools, runContext: options?.runContext, model: options?.model ?? this.options.model });
      if (result) {
        if ('systemPrompt' in result && result.systemPrompt !== undefined) {
          systemPrompt = result.systemPrompt;
        }
        if ('tools' in result && result.tools !== undefined) {
          tools = result.tools;
        }
      }
    }

    // Collect all hook arrays for the loop
    const loopHooks = this.collectLoopHooks();

    const resultText = await loop(context, {
      ...options,
      tools,
      provider: options?.provider
        ?? (options?.modelType ? buildProvider(options.modelType) : undefined)
        ?? this.options.llmProvider
        ?? (this.options.modelType ? buildProvider(this.options.modelType) : undefined),
      model: options?.model ?? this.options.model,
      systemPrompt,
      hooks: loopHooks,
      onToolCall: (toolCall) => {
        options?.onToolCall?.(toolCall);
      },
      onClarificationRequest: options?.onClarificationRequest,
    });

    // --- afterRun hooks ---
    const afterRunHooks = this.pluginManager.getHooks('afterRun');
    for (const hook of afterRunHooks) {
      await hook({ context, result: resultText });
    }

    return resultText;
  }

  /**
   * 手动触发上下文压缩
   * 默认复用 Engine 初始化时配置的 provider/model
   */
  async compactContext(
    context: Context,
    options?: { force?: boolean; provider?: LLMProviderFactory; model?: string }
  ): Promise<{ didCompact: boolean; reason?: string; newMessages?: Context['messages'] }> {
    return await maybeCompactContext(context, {
      force: options?.force,
      provider: options?.provider ?? this.options.llmProvider,
      model: options?.model ?? this.options.model,
    });
  }

  /**
   * 获取插件状态
   */
  getPluginStatus() {
    return this.pluginManager.getStatus();
  }

  /**
   * 获取工具
   */
  getTools(): Record<string, any> {
    return { ...this.tools };
  }

  /**
   * Create a policy-aware tool session for an external model harness.
   * beforeRun runs once; beforeLLMCall filters the visible table initially and
   * after every tool result. This preserves deferred loading, PTC filtering,
   * dynamic skill descriptions, and the normal tool hook boundary.
   */
  async createToolSession(
    context: Context,
    options: {
      runContext?: Record<string, any>;
      model?: string;
      systemPrompt?: SystemPromptOption;
    } = {},
  ): Promise<EngineToolSession> {
    // External harness messages stay owned by that harness. Keep a private
    // policy transcript so hooks still observe this session's tool results.
    const policyContext: Context = { ...context, messages: [...context.messages] };
    let tools: Record<string, Tool> = { ...this.tools };
    let systemPrompt = options.systemPrompt ?? this.options.systemPrompt;
    const hooks = this.collectLoopHooks();
    let visibleTools: Record<string, Tool> = {};
    let llmCallOpen = false;
    let disposed = false;
    let afterRunCalled = false;
    const finishRun = async (result: string) => {
      if (afterRunCalled) return;
      afterRunCalled = true;
      for (const hook of this.pluginManager.getHooks('afterRun')) {
        await hook({ context: policyContext, result });
      }
    };
    const closeLLMCall = async (finishReason: string) => {
      if (!llmCallOpen) return;
      llmCallOpen = false;
      for (const hook of hooks.afterLLMCall ?? []) {
        await hook({
          context: policyContext,
          finishReason,
          text: '',
          model: options.model ?? this.options.model,
        });
      }
    };
    const refreshVisibleTools = async () => {
      let nextTools = tools;
      let nextPrompt = systemPrompt;
      for (const hook of hooks.beforeLLMCall ?? []) {
        const result = await hook({
          context: policyContext,
          systemPrompt: nextPrompt,
          tools: nextTools,
          runContext: options.runContext,
          model: options.model ?? this.options.model,
        });
        if (result && 'systemPrompt' in result && result.systemPrompt !== undefined) {
          nextPrompt = result.systemPrompt;
        }
        if (result && 'tools' in result && result.tools !== undefined) {
          nextTools = result.tools;
        }
      }
      visibleTools = nextTools;
      llmCallOpen = true;
    };
    try {
      for (const hook of this.pluginManager.getHooks('beforeRun')) {
        const result = await hook({
          context: policyContext,
          systemPrompt,
          tools,
          runContext: options.runContext,
          model: options.model ?? this.options.model,
        });
        if (result && 'systemPrompt' in result && result.systemPrompt !== undefined) {
          systemPrompt = result.systemPrompt;
        }
        if (result && 'tools' in result && result.tools !== undefined) {
          tools = result.tools;
        }
      }
      await refreshVisibleTools();
    } catch (error) {
      // The caller cannot dispose a session that failed before being returned.
      // Attempt lifecycle rollback while preserving the original init error.
      try {
        await finishRun('');
      } catch {
        // Initialization failure remains the actionable primary error.
      }
      throw error;
    }

    return {
      getTools: () => ({ ...visibleTools }),
      executeTool: async (name, input, toolContext) => {
        if (disposed) throw new Error('Engine tool session is disposed');
        const tool = visibleTools[name];
        if (!tool || typeof tool.execute !== 'function') {
          throw new Error(`Unknown or unavailable tool: ${name}`);
        }
        // The external model has just ended one LLM step with this tool call.
        await closeLLMCall('tool-calls');
        let output: unknown;
        try {
          output = await this.executeResolvedTool(tool, name, input, {
            context: policyContext,
            toolContext,
          });
        } catch (error) {
          // Pi continues with another model step after receiving a tool error.
          await refreshVisibleTools();
          throw error;
        }

        const toolCallId = toolContext?.toolCallId ?? `external:${name}`;
        policyContext.messages.push({
          role: 'tool',
          content: [{
            type: 'tool-result',
            toolCallId,
            toolName: name,
            output: { type: 'json', value: output },
          }],
        } as any);
        await refreshVisibleTools();
        return output;
      },
      dispose: async (result = '') => {
        if (disposed) return;
        disposed = true;
        try {
          await closeLLMCall('stop');
        } finally {
          await finishRun(result);
        }
      },
    };
  }

  private async executeResolvedTool(
    tool: Tool,
    name: string,
    input: unknown,
    options: { context: Context; toolContext?: ToolExecutionContext },
  ): Promise<unknown> {

    const schema = asSchema(tool.inputSchema);
    let validatedInput = input;
    if (schema.validate) {
      const result = await schema.validate(input);
      if (!result.success) {
        throw new Error(`Invalid input for tool ${name}: ${result.error.message}`);
      }
      validatedInput = result.value;
    }

    const hooks = this.collectLoopHooks();
    let finalInput = validatedInput;
    let finalToolContext = options.toolContext;
    let shortCircuitOutput: unknown;
    let shortCircuited = false;
    for (const hook of hooks.beforeToolCall ?? []) {
      const result = await hook({
        context: options.context,
        name,
        input: finalInput,
        toolContext: finalToolContext,
      });
      if (result && 'input' in result) finalInput = result.input;
      if (result && 'toolContext' in result) finalToolContext = result.toolContext;
      if (result && 'output' in result) {
        shortCircuitOutput = result.output;
        shortCircuited = true;
        break;
      }
    }

    let output = shortCircuited
      ? shortCircuitOutput
      : await tool.execute(finalInput, finalToolContext);
    for (const hook of hooks.afterToolCall ?? []) {
      const result = await hook({
        context: options.context,
        name,
        input: finalInput,
        output,
      });
      if (result && 'output' in result) output = result.output;
    }
    return output;
  }

  /**
   * 获取服务
   */
  getService<T>(name: string): T | undefined {
    return this.pluginManager.getService<T>(name);
  }

  /**
   * 获取 plan mode 服务
   */
  private getPlanModeService(): PlanModeService | undefined {
    return this.getService<PlanModeService>('planMode') ?? this.getService<PlanModeService>('planModeService');
  }

  /**
   * 获取当前模式
   */
  getMode(): PlanMode | undefined {
    return this.getPlanModeService()?.getMode();
  }

  /**
   * 设置当前模式
   */
  setMode(mode: PlanMode, reason: string = 'manual'): boolean {
    const planModeService = this.getPlanModeService();
    if (!planModeService) {
      return false;
    }

    planModeService.setMode(mode, reason);
    return true;
  }

  /**
   * 获取配置
   */
  getConfig<T>(key: string): T | undefined {
    return this.config[key];
  }

  /**
   * 设置配置
   */
  setConfig<T>(key: string, value: T): void {
    this.config[key] = value;
  }
}

// 重新导出类型
export * from './shared/types.js';
export * from './plugin/EnginePlugin.js';
export * from './plugin/UserConfigPlugin.js';
export { loop } from './core/loop.js';
export type { LoopOptions, LoopHooks, CompactionEvent } from './core/loop.js';
export { streamTextAI } from './ai/index.js';
export { maybeCompactContext } from './context/index.js';
export * from './tools/index.js';
