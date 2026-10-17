import path from 'path';
import { glob } from 'glob';
import { EventEmitter } from 'events';

import type { EnginePlugin, EnginePluginContext, EnginePluginLoadOptions, EngineHookMap, EngineHookName } from './EnginePlugin.js';
import type { UserConfigPluginLoadOptions } from './UserConfigPlugin.js';
import type { ILogger, PulseEngineInstance } from '../shared/types.js';

// Internal storage: each hook name maps to an array of handlers
type HookStore = {
  [K in EngineHookName]: Array<EngineHookMap[K]>;
};

/**
 * 插件管理器 - 管理双轨插件系统
 */
export class PluginManager {
  private enginePlugins = new Map<string, EnginePlugin>();
  /** Initialization order with each plugin's context, for reverse-order destroy. */
  private initialized: Array<{ plugin: EnginePlugin; context: EnginePluginContext }> = [];
  private destroyed = false;
  private tools = new Map<string, any>();
  private toolOwners = new Map<string, string>();
  private hooks: HookStore = {
    beforeRun: [],
    afterRun: [],
    beforeLLMCall: [],
    prepareToolPresentation: [],
    afterLLMCall: [],
    beforeToolCall: [],
    afterToolCall: [],
    onToolCall: [],
    onCompacted: [],
  };
  private services = new Map<string, any>();
  private config = new Map<string, any>();

  private events = new EventEmitter();
  private logger: ILogger;

  private getEngineInstance: () => PulseEngineInstance;

  constructor(getEngineInstance: () => PulseEngineInstance, logger?: ILogger,) {
    this.logger = logger ?? {
      debug: (msg: string, meta?: any) => console.debug(`[PluginManager] ${msg}`, meta),
      info: (msg: string, meta?: any) => console.info(`[PluginManager] ${msg}`, meta),
      warn: (msg: string, meta?: any) => console.warn(`[PluginManager] ${msg}`, meta),
      error: (msg: string, error?: Error, meta?: any) => console.error(`[PluginManager] ${msg}`, error, meta),
    };

    this.getEngineInstance = getEngineInstance;
  }

  /**
   * 初始化插件系统
   */
  async initialize(options: {
    enginePlugins?: EnginePluginLoadOptions;
    /** @deprecated Ignored. Declarative user-config was never applied and has been removed. */
    userConfigPlugins?: UserConfigPluginLoadOptions;
  } = {}): Promise<void> {
    this.logger.info('Initializing plugin system...');

    try {
      // 1. 加载引擎插件（优先）
      await this.loadEnginePlugins(options.enginePlugins);

      // 2. 验证核心能力
      await this.validateCoreCapabilities();

      this.logger.info('Plugin system initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize plugin system', error as Error);
      throw error;
    }
  }

  /**
   * 加载引擎插件
   */
  private async loadEnginePlugins(options: EnginePluginLoadOptions = {}): Promise<void> {
    const plugins: EnginePlugin[] = [];

    // 1. API传入的插件（最高优先级）
    if (options.plugins) {
      plugins.push(...options.plugins);
    }

    // 2. 目录扫描的插件
    if (options.scan !== false) {
      const scanPaths = options.dirs || [
        '.pulse-coder/engine-plugins',
        '.coder/engine-plugins',
        '~/.pulse-coder/engine-plugins',
        '~/.coder/engine-plugins'
      ];

      for (const dir of scanPaths) {
        const scannedPlugins = await this.scanEnginePlugins(dir);
        plugins.push(...scannedPlugins);
      }
    }

    // 3. 按依赖顺序初始化插件
    const sortedPlugins = this.sortPluginsByDependencies(plugins);

    for (const plugin of sortedPlugins) {
      await this.initializeEnginePlugin(plugin);
    }
  }

  /**
   * 扫描引擎插件目录
   */
  private async scanEnginePlugins(dir: string): Promise<EnginePlugin[]> {
    const plugins: EnginePlugin[] = [];
    const resolvedDir = this.resolvePath(dir);

    try {
      const pattern = '**/*.plugin.{js,ts}';
      const files = await glob(pattern, { cwd: resolvedDir, absolute: true });

      for (const file of files) {
        try {
          const plugin = await this.loadEnginePluginFile(file);
          plugins.push(plugin);
          this.logger.info(`Loaded engine plugin: ${plugin.name} from ${file}`);
        } catch (error) {
          this.logger.error(`Failed to load engine plugin from ${file}`, error as Error);
        }
      }
    } catch (error) {
      // 目录不存在是正常现象
      this.logger.debug(`Directory not found: ${resolvedDir}`);
    }

    return plugins;
  }

  /**
   * 加载单个引擎插件文件
   */
  private async loadEnginePluginFile(filePath: string): Promise<EnginePlugin> {
    const plugin = await import(filePath);

    // 支持 default export 或直接导出
    const enginePlugin = plugin.default || plugin;

    if (!enginePlugin.name || !enginePlugin.initialize) {
      throw new Error(`Invalid engine plugin: ${filePath}`);
    }

    return enginePlugin;
  }

  /**
   * 初始化单个引擎插件
   */
  private async initializeEnginePlugin(plugin: EnginePlugin): Promise<void> {
    const startedAt = Date.now();
    let ok = false;
    try {
      // 检查依赖
      if (plugin.dependencies) {
        for (const dep of plugin.dependencies) {
          if (!this.enginePlugins.has(dep)) {
            throw new Error(`Dependency not found: ${dep} for plugin ${plugin.name}`);
          }
        }
      }

      const registerTool = (name: string, tool: any) => {
        const owner = this.toolOwners.get(name);
        if (owner !== undefined && owner !== plugin.name) {
          this.logger.warn(`Tool "${name}" from plugin "${plugin.name}" replaces the one from "${owner}"`);
        }
        this.tools.set(name, tool);
        this.toolOwners.set(name, plugin.name);
      };
      const context: EnginePluginContext = {
        registerTool,
        registerTools: (tools) => {
          Object.entries(tools).forEach(([name, tool]) => registerTool(name, tool));
        },
        getTool: (name) => this.tools.get(name),
        getTools: () => Object.fromEntries(this.tools),

        getEngineInstance: () => {
          return this.getEngineInstance();
        },

        registerHook: (hookName, handler) => {
          const wrapped = async (input: any) => {
            const start = Date.now();
            try {
              return await (handler as any)(input);
            } finally {
              const payload = {
                hookName,
                pluginName: plugin.name,
                durationMs: Date.now() - start,
                at: start,
                context: input?.context,
              };
              try {
                this.events.emit('hookTiming', payload);
              } catch {
                // best-effort only
              }
            }
          };
          this.hooks[hookName].push(wrapped as any);
          this.logger.debug(`Plugin "${plugin.name}" registered hook: ${hookName}`);
        },

        registerService: (name, service) => {
          this.services.set(name, service);
        },
        getService: (name) => this.services.get(name),

        getConfig: (key) => this.config.get(key),
        setConfig: (key, value) => this.config.set(key, value),

        events: this.events,
        logger: this.logger
      };

      // 执行生命周期钩子
      if (plugin.beforeInitialize) {
        await plugin.beforeInitialize(context);
      }

      await plugin.initialize(context);

      if (plugin.afterInitialize) {
        await plugin.afterInitialize(context);
      }

      this.enginePlugins.set(plugin.name, plugin);
      this.initialized.push({ plugin, context });
      ok = true;

    } catch (error) {
      throw new Error(`Failed to initialize engine plugin ${plugin.name}: ${error}`);
    } finally {
      try {
        this.events.emit('pluginInitTiming', {
          pluginName: plugin.name,
          startedAt,
          durationMs: Date.now() - startedAt,
          ok,
        });
      } catch {
        // best-effort only
      }
    }
  }

  /**
   * 验证核心能力
   *
   * - requiredCapabilities: 任意一个别名匹配即可，缺失时 **抛错** 阻止启动。
   * - recommendedCapabilities: 缺失时仅 warn，不影响启动。
   */
  private async validateCoreCapabilities(): Promise<void> {
    // 目前引擎没有强制依赖某个具体插件，留空供未来扩展
    const requiredCapabilities: Array<{ name: string; aliases: string[] }> = [];

    for (const cap of requiredCapabilities) {
      const found = cap.aliases.some((alias) => this.enginePlugins.has(alias));
      if (!found) {
        throw new Error(
          `Missing required capability "${cap.name}". ` +
          `Expected one of: ${cap.aliases.join(', ')}`
        );
      }
    }

    // 推荐能力：缺失只警告，不阻止启动
    const recommendedCapabilities: Array<{ name: string; aliases: string[] }> = [
      {
        name: 'skills',
        aliases: ['pulse-coder-engine/built-in-skills']
      }
    ];

    for (const cap of recommendedCapabilities) {
      const found = cap.aliases.some((alias) => this.enginePlugins.has(alias));
      if (!found) {
        this.logger.warn(
          `Missing recommended capability "${cap.name}". ` +
          `Expected one of: ${cap.aliases.join(', ')}`
        );
      }
    }
  }

  /**
   * 插件依赖排序
   */
  private sortPluginsByDependencies(plugins: EnginePlugin[]): EnginePlugin[] {
    const sorted: EnginePlugin[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (plugin: EnginePlugin) => {
      if (visited.has(plugin.name)) return;
      if (visiting.has(plugin.name)) {
        throw new Error(`Circular dependency detected: ${plugin.name}`);
      }

      visiting.add(plugin.name);

      if (plugin.dependencies) {
        for (const dep of plugin.dependencies) {
          const depPlugin = plugins.find(p => p.name === dep);
          if (depPlugin) {
            visit(depPlugin);
          }
        }
      }

      visiting.delete(plugin.name);
      visited.add(plugin.name);
      sorted.push(plugin);
    };

    for (const plugin of plugins) {
      visit(plugin);
    }

    return sorted;
  }

  /**
   * 工具获取
   */
  getTools(): Record<string, any> {
    return Object.fromEntries(this.tools);
  }

  /**
   * 获取指定类型的 hook 处理函数数组
   */
  getHooks<K extends EngineHookName>(hookName: K): Array<EngineHookMap[K]> {
    return [...this.hooks[hookName]] as Array<EngineHookMap[K]>;
  }

  /**
   * 服务获取
   */
  getService<T>(name: string): T | undefined {
    return this.services.get(name);
  }

  getConfig<T>(key: string): T | undefined {
    return this.config.get(key);
  }

  setConfig<T>(key: string, value: T): void {
    this.config.set(key, value);
  }

  /**
   * Destroy plugins in reverse initialization order so dependents release
   * before their dependencies. Idempotent; one failing plugin does not stop
   * the others from releasing resources (MCP child processes, connections).
   */
  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const { plugin, context } of [...this.initialized].reverse()) {
      if (!plugin.destroy) continue;
      try {
        await plugin.destroy(context);
      } catch (error) {
        this.logger.error(`Failed to destroy engine plugin ${plugin.name}`, error as Error);
      }
    }
  }

  /**
   * 事件发射器（插件上下文共享同一个实例）
   */
  getEvents(): EventEmitter {
    return this.events;
  }

  /**
   * 获取插件状态
   */
  getStatus() {
    return {
      enginePlugins: Array.from(this.enginePlugins.keys()),
      tools: Array.from(this.tools.keys()),
      hooks: Object.fromEntries(
        Object.entries(this.hooks).map(([k, v]) => [k, (v as any[]).length])
      ),
      services: Array.from(this.services.keys())
    };
  }

  /**
   * 解析路径（支持 ~ 和相对路径）
   */
  private resolvePath(dir: string): string {
    if (dir.startsWith('~/')) {
      return path.join(process.env.HOME || process.env.USERPROFILE || '', dir.slice(2));
    }
    return path.resolve(dir);
  }
}
