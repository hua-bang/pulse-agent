# pulse-coder-engine 双轨插件系统

> **状态说明**：本文档反映 `packages/engine/src/plugin/` 的当前代码。API 签名以源码为唯一事实来源（SSOT）：`EnginePlugin.ts`、`PluginManager.ts`、`UserConfigPlugin.ts`、`Engine.ts`。同目录下的 `API-REFERENCE.md`、`EXAMPLES.md`、`ARCHITECTURE.md` 是早期设计草稿，已与代码漂移，**不要**据其拷贝 API——遇到不一致一律以源码为准。
>
> 仓库无 CI、无 git hook、无可执行的 harness 校验（见根 `AGENTS.md` §4）。本文档中标注「未实现」的能力确实不存在，不要假设有自动化门禁在生效。

## 概述

pulse-coder-engine 采用分层插件架构，提供两套隔离的插件系统：

1. **引擎开发插件系统**（`EnginePlugin`）—— 为引擎开发者提供运行时扩展能力（工具、钩子、服务）。初始化失败会中断引擎启动。
2. **用户配置插件系统**（`UserConfigPlugin`）—— 为终端用户提供声明式配置能力（JSON/YAML）。单个配置出错只记录日志，不中断引擎。

两者由 `PluginManager`（`packages/engine/src/plugin/PluginManager.ts`）统一管理，加载顺序为：引擎插件 → 核心能力校验 → 用户配置。

## 架构设计

```
┌─────────────────────────────────────────────────────────┐
│                    pulse-coder-engine                    │
│  ┌─────────────────────┐    ┌─────────────────────┐    │
│  │  引擎开发插件系统    │    │  用户配置插件系统    │    │
│  │  (EnginePlugin)     │    │  (UserConfigPlugin)  │    │
│  │  - API 传入         │    │  - API 传入         │    │
│  │  - 目录扫描         │    │  - 目录扫描         │    │
│  │  - 注册工具/钩子/服务│    │  - 声明式配置       │    │
│  │  - 失败即中断启动   │    │  - 错误隔离（仅记录）│    │
│  └─────────────────────┘    └─────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

## 引擎开发插件系统

### 核心定位
为引擎开发者提供运行时扩展能力：注册工具、注册引擎钩子、注册服务。钩子是引擎的核心扩展面（见下文「钩子系统」）。

### 插件接口

源码：`packages/engine/src/plugin/EnginePlugin.ts`。

```typescript
interface EnginePlugin {
  name: string;
  version: string;
  dependencies?: string[]; // 依赖的其他插件 name；缺失或循环依赖会抛错

  beforeInitialize?(context: EnginePluginContext): Promise<void>;
  initialize(context: EnginePluginContext): Promise<void>;
  afterInitialize?(context: EnginePluginContext): Promise<void>;

  destroy?(context: EnginePluginContext): Promise<void>;
}
```

插件上下文（`EnginePluginContext`，`EnginePlugin.ts:163-194`）：

```typescript
interface EnginePluginContext {
  // 工具注册
  registerTool(name: string, tool: any): void;        // 注意：name + tool 两个参数
  registerTools(tools: Record<string, any>): void;
  getTool(name: string): any;
  getTools(): Record<string, any>;

  getEngineInstance(): PulseEngineInstance;

  // 钩子注册 —— 引擎核心扩展机制
  registerHook<K extends EngineHookName>(hookName: K, handler: EngineHookMap[K]): void;

  // 服务注册
  registerService<T>(name: string, service: T): void;
  getService<T>(name: string): T | undefined;

  // 配置
  getConfig<T>(key: string): T | undefined;
  setConfig<T>(key: string, value: T): void;

  // 事件与日志
  events: EventEmitter;                               // 每次 hook 执行会 emit 'hookTiming'
  logger: {
    debug(message: string, meta?: any): void;
    info(message: string, meta?: any): void;
    warn(message: string, meta?: any): void;
    error(message: string, error?: Error, meta?: any): void;
  };
}
```

> ⚠️ `registerTool` 的签名是 `(name, tool)`，不是 `(tool)`。早期文档与 `API-REFERENCE.md` 中的 `registerTool(tool: Tool)` 是错误的。

### 钩子系统

引擎在运行循环的各关键点暴露 8 个钩子（`EngineHookMap`，`EnginePlugin.ts:115-139`）。插件在 `initialize` 内通过 `context.registerHook(hookName, handler)` 注册，`Engine` 会在 `run()` 中收集并通过 `LoopHooks` 注入循环（`Engine.ts:209-237`）。

| 钩子 | 触发时机 | 可否修改输入/输出 |
|---|---|---|
| `beforeRun` | `Engine.run()` 开始、进入循环前 | 可返回新 `systemPrompt` / `tools` |
| `afterRun` | `Engine.run()` 结束 | 只读 |
| `beforeLLMCall` | 每次 LLM 调用前（含工具调用后的重试） | 可返回新 `systemPrompt` / `tools` |
| `afterLLMCall` | 每次 LLM 调用结束 | 只读（含 `finishReason`、`usage`、`timings`、`error`） |
| `beforeToolCall` | 每次工具执行前 | 可改 `input`，或抛错中止该次调用 |
| `afterToolCall` | 每次工具执行后 | 可改 `output`（如脱敏、截断） |
| `onToolCall` | LLM 产出 tool-call chunk 时 | 只读 |
| `onCompacted` | 上下文压缩产出新消息列表后 | 只读（含压缩前后 token/消息数） |

注册示例：

```typescript
const myPlugin: EnginePlugin = {
  name: 'audit-log',
  version: '1.0.0',
  async initialize(context) {
    context.registerHook('afterToolCall', async ({ name, input, output }) => {
      context.logger.info(`tool ${name} executed`, { input });
      return { output }; // 不改写原样返回
    });
  },
};
```

> `EngineOptions.hooks`（`ToolHooks`）是业务方的简化快捷方式，会被内部转换为 `beforeToolCall` / `afterToolCall` 钩子（`Engine.ts:219-234`），与插件注册的钩子合并。

### 加载机制

`Engine` 构造函数接收 `enginePlugins?: EnginePluginLoadOptions`（`EnginePlugin.ts:200-204`）：

```typescript
interface EnginePluginLoadOptions {
  plugins?: EnginePlugin[]; // API 传入
  dirs?: string[];          // 自定义扫描目录
  scan?: boolean;           // 默认 true；设为 false 跳过目录扫描
}
```

```typescript
import { Engine, type EnginePlugin } from 'pulse-coder-engine';

const engine = new Engine({
  enginePlugins: {
    plugins: [myPlugin],          // 不是裸数组，是 { plugins, dirs, scan }
    dirs: ['./custom-engine-plugins'],
    scan: true,
  },
});
await engine.initialize();
```

默认扫描目录（导出常量 `DEFAULT_ENGINE_PLUGIN_DIRS`，`EnginePlugin.ts:206-212`，`.pulse-coder/` 优先）：

```typescript
const DEFAULT_ENGINE_PLUGIN_DIRS = [
  '.pulse-coder/engine-plugins',
  '.coder/engine-plugins',
  '~/.pulse-coder/engine-plugins',
  '~/.coder/engine-plugins',
  './plugins/engine',
];
```

> ⚠️ 该常量已导出但**未被扫描器引用**：`PluginManager.loadEnginePlugins`（`PluginManager.ts:91-96`）与 `Engine.prepareEnginePlugins`（`Engine.ts:200`）在未传 `dirs` 时各用一份内联的 4 项默认值，**不含** `./plugins/engine`——即 `./plugins/engine` 实际不会被默认扫描。

文件命名：扫描器使用 glob `**/*.plugin.{js,ts}`（`PluginManager.ts:120`）——只加载 `.js` / `.ts`，不加载 `.d.ts`。文件支持 default export 或直接导出对象（`PluginManager.ts:143-154`）。

### 插件生命周期

```
1. 发现阶段 → 2. 验证阶段 → 3. 初始化阶段 → 4. 运行阶段
   扫描目录    依赖检查      执行钩子      提供服务
   API传入     版本/循环依赖 beforeInitialize 事件监听
                            initialize
                            afterInitialize
```

### 内置插件

`Engine` 默认自动加载 9 个内置插件（`packages/engine/src/built-in/index.ts:20-30`），可用 `EngineOptions.disableBuiltInPlugins` 关闭。所有插件通过 `pulse-coder-engine/built-in` 子路径或包根导入。

| 插件 | 注册 name | 模块 |
|---|---|---|
| MCP | `pulse-coder-engine/built-in-mcp` | `built-in/mcp-plugin` |
| Skills | `pulse-coder-engine/built-in-skills` | `built-in/skills-plugin` |
| Tool Search | `pulse-coder-engine/built-in-tool-search` | `built-in/tool-search-plugin` |
| Plan Mode | `pulse-coder-engine/built-in-plan-mode` | `built-in/plan-mode-plugin` |
| Task Tracking | `pulse-coder-engine/built-in-task-tracking` | `built-in/task-tracking-plugin` |
| Sub Agent | `sub-agent` | `built-in/sub-agent-plugin` |
| Agent Teams | `pulse-coder-engine/built-in-agent-teams` | `built-in/agent-teams-plugin` |
| Role Soul | `pulse-coder-engine/built-in-role-soul` | `built-in/role-soul-plugin` |
| PTC | `pulse-coder-engine/built-in-ptc` | `built-in/ptc-plugin` |

> 内置插件加载是「推荐能力」而非硬依赖：`PluginManager.validateCoreCapabilities()`（`PluginManager.ts:383-414`）目前只对缺失的 `skills` 能力 `warn`，不阻止启动。

### 引擎插件示例

```typescript
import type { EnginePlugin } from 'pulse-coder-engine';

const myPlugin: EnginePlugin = {
  name: 'my-custom-plugin',
  version: '1.0.0',

  async initialize(context) {
    context.registerTool('customTool', {
      name: 'customTool',
      description: 'A custom tool',
      execute: async (input: string) => `Processed: ${input}`,
    });

    context.registerService('myService', { ready: true });
    context.registerHook('beforeRun', async () => undefined);
  },
};

export default myPlugin;
```

## 用户配置插件系统

### 核心定位
为终端用户提供声明式配置能力，无需编码即可声明工具 / MCP 服务器 / 子代理 / 提示词 / 技能扫描。配置支持 JSON / YAML，并自动做 `${VAR}` / `${VAR:-default}` 环境变量替换（`ConfigVariableResolver`，`UserConfigPlugin.ts:153-183`）。

### 配置接口

源码：`packages/engine/src/plugin/UserConfigPlugin.ts:7-45`。

```typescript
interface UserConfigPlugin {
  version: string;
  name?: string;
  description?: string;

  tools?: Record<string, ToolConfig>;
  mcp?: { servers: MCPServerConfig[] };     // servers 必填（非可选）
  prompts?: { system?: string; user?: string; assistant?: string };
  subAgents?: SubAgentConfig[];
  skills?: { directories?: string[]; autoScan?: boolean; cache?: boolean };
  env?: Record<string, string>;
  conditions?: { environment?: string; features?: string[] };
}
```

> 接口名是 `UserConfigPlugin`，不是 `UserConfig`。`SubAgentConfig.trigger` 是 `string[]`（`z.array(z.string())`，`UserConfigPlugin.ts:105`），不是单个字符串——写成字符串会通不过 schema 校验。

#### JSON 配置示例

```json
{
  "version": "1.0",
  "name": "my-project-config",
  "description": "Project-level config",
  "mcp": {
    "servers": [
      {
        "name": "filesystem",
        "command": "npx",
        "args": ["@modelcontextprotocol/server-filesystem"]
      }
    ]
  },
  "subAgents": [
    {
      "name": "codeReviewer",
      "trigger": ["code review", "review"],
      "prompt": "Review this code for best practices..."
    }
  ]
}
```

#### YAML 配置示例

```yaml
version: '1.0'
name: my-project-config

mcp:
  servers:
    - name: filesystem
      command: npx
      args: ['@modelcontextprotocol/server-filesystem']

subAgents:
  - name: codeReviewer
    trigger: ['code review', 'review']
    prompt: Review this code for best practices...
```

### 配置校验

各字段有对应的 zod schema：`ToolConfigSchema`、`MCPServerConfigSchema`、`SubAgentConfigSchema`（`UserConfigPlugin.ts:50-114`）。校验结果类型为 `ConfigValidationResult`（`valid` / `errors` / `warnings`）。

### 加载机制

`Engine` 构造函数接收 `userConfigPlugins?: UserConfigPluginLoadOptions`（`UserConfigPlugin.ts:119-123`）：

```typescript
interface UserConfigPluginLoadOptions {
  configs?: UserConfigPlugin[]; // API 传入
  dirs?: string[];
  scan?: boolean;
}
```

```typescript
const engine = new Engine({
  userConfigPlugins: {        // 字段名是 userConfigPlugins，不是 userConfigs；值是对象不是数组
    configs: [customConfig],
    dirs: ['./project-config'],
    scan: true,
  },
});
```

默认扫描目录（导出常量 `DEFAULT_USER_CONFIG_PLUGIN_DIRS`，`UserConfigPlugin.ts:128-134`）：

```typescript
const DEFAULT_USER_CONFIG_PLUGIN_DIRS = [
  '.pulse-coder/config',
  '.coder/config',
  '~/.pulse-coder/config',
  '~/.coder/config',
  './config',
];
```

> ⚠️ 同上：该常量已导出但**未被扫描器引用**。`PluginManager.loadUserConfigPlugins`（`PluginManager.ts:253-258`）在未传 `dirs` 时使用内联的 4 项默认值，**不含** `./config`——即 `./config` 实际不会被默认扫描。

扫描文件名：`config.{json,yaml,yml}` 与 `*.config.{json,yaml,yml}`（`PluginManager.ts:280`）。支持后缀：`.json` / `.yaml` / `.yml`（`SUPPORTED_CONFIG_FORMATS`，`UserConfigPlugin.ts:139`）。

### 错误处理与隔离

用户配置的解析与应用被 try/catch 包裹（`PluginManager.applyUserConfig`，`PluginManager.ts:335-375`）：单个配置出错只 `logger.error` 并跳过，不中断引擎。环境变量替换失败时回退到原值或默认值。

> **未实现的子能力**：`applyUserConfig` 目前对 `tools` / `mcp.servers` / `subAgents` 只 `logger.debug` 记录名称，**尚未**真正构造工具实例、连接 MCP 服务器或注册子代理（`PluginManager.ts:338-363`）。配置会被解析、做环境变量替换并存入 `userConfigPlugins`，但落地为运行时能力尚未完成。需要实际生效的 MCP / 子代理 / 工具请改用引擎插件或内置插件。

## 插件加载顺序

引擎插件**不按字母顺序**加载。流程（`PluginManager.loadEnginePlugins` + `sortPluginsByDependencies`，`PluginManager.ts:81-110, 419-451`）：

1. 收集 `options.plugins`（含内置插件 + API 传入插件）+ 目录扫描结果；
2. 调用 `sortPluginsByDependencies` 做依赖拓扑排序——依赖先初始化，被依赖者后初始化；
3. 缺失依赖抛 `Dependency not found`，循环依赖抛 `Circular dependency detected`；
4. 依次执行 `beforeInitialize` → `initialize` → `afterInitialize`。

用户配置无显式排序：`options.configs` 与目录扫描结果按 fs/glob 返回顺序依次 `applyUserConfig`（`PluginManager.ts:243-270`）。

## EngineOptions 字段一览

源码：`packages/engine/src/Engine.ts:17-123`。

| 字段 | 类型 | 说明 |
|---|---|---|
| `enginePlugins` | `EnginePluginLoadOptions` | 引擎插件加载选项 |
| `userConfigPlugins` | `UserConfigPluginLoadOptions` | 用户配置加载选项 |
| `disableBuiltInPlugins` | `boolean` | 关闭 9 个内置插件 |
| `tools` | `Record<string, Tool>` | 直接注册自定义工具（优先级高于内置工具） |
| `systemPrompt` | `SystemPromptOption` | `string` / `() => string` / `{ append: string }` |
| `hooks` | `ToolHooks` | `onBeforeToolCall` / `onAfterToolCall` 简写，内部转为钩子 |
| `model` / `modelType` / `llmProvider` | `string` / `ModelType` / `LLMProviderFactory` | 模型与 provider 配置 |
| `config` | `Record<string, any>` | 全局配置（`getConfig` / `setConfig` 读写） |
| `logger` | `ILogger` | 自定义日志实现 |

## 类型与导入

包 `pulse-coder-engine` 的 `exports`（`packages/engine/package.json`）只有 `.`、`./src`、`./types`、`./built-in`——**没有** `./engine-plugin` 或 `./user-config` 子路径。所有类型从包根导入：

```typescript
import { Engine, PluginManager, builtInPlugins } from 'pulse-coder-engine';
import type {
  EnginePlugin,
  EnginePluginContext,
  EngineHookMap,
  EngineHookName,
} from 'pulse-coder-engine';
import type { UserConfigPlugin, UserConfigPluginLoadOptions } from 'pulse-coder-engine';
```

## 监控与调试

`Engine.getPluginStatus()` 透传 `PluginManager.getStatus()`（`PluginManager.ts:477-487`），返回：

```typescript
{
  enginePlugins: ['pulse-coder-engine/built-in-mcp', 'sub-agent', /* ... */],
  userConfigPlugins: ['my-project-config', /* 或 'unnamed' */],
  tools: ['bash', 'read', /* ... */],
  hooks: { beforeRun: 1, afterRun: 0, beforeLLMCall: 2, /* 8 个钩子各自的 handler 计数 */ },
  services: ['planMode', 'mcpClient', /* ... */],
}
```

> 该返回**没有** `loadedPlugins` / `errors` / `performance` 字段——早期文档中的 `loadedPlugins.{engine,user}`、`errors`、`performance.{loadTime,memoryUsage}` 不存在。钩子耗时信号通过 `context.events` 上的 `'hookTiming'` 事件暴露（`PluginManager.ts:186-205`），可自行 `events.on('hookTiming', ...)` 采集。

## 测试

真实测试文件：`packages/engine/src/plugin/plugin-manager.test.ts`（`vitest run`）。直接构造 `new PluginManager(logger)` 并调用 `manager.initialize({ enginePlugins: { plugins, scan: false }, userConfigPlugins: { scan: false } })`，断言初始化顺序、依赖缺失/循环依赖抛错、`getTools` / `getService` / `getHooks` / `getStatus` 返回值。

> 早期文档中的 `createTestContext` / `validateConfig` / `loadConfig` 测试辅助函数在源码中不存在（grep 零命中）。写测试时直接用 `PluginManager` + 自定义 `EnginePlugin` 对象即可。

```typescript
import { describe, expect, it, vi } from 'vitest';
import { PluginManager } from './PluginManager.js';
import type { EnginePlugin } from './EnginePlugin.js';

const createLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe('PluginManager', () => {
  it('initializes plugins by dependency order', async () => {
    const order: string[] = [];
    const alpha: EnginePlugin = {
      name: 'alpha', version: '1.0.0',
      initialize: async (ctx) => { order.push('alpha'); ctx.registerTool('alphaTool', {}); },
    };
    const beta: EnginePlugin = {
      name: 'beta', version: '1.0.0', dependencies: ['alpha'],
      initialize: async () => { order.push('beta'); },
    };
    // 注意：PluginManager 构造函数签名为 (getEngineInstance, logger?)，
    // 真实测试将 createLogger() 作为首参传入（被测插件不调用 getEngineInstance）。
    const manager = new PluginManager(createLogger());
    await manager.initialize({
      enginePlugins: { plugins: [beta, alpha], scan: false },
      userConfigPlugins: { scan: false },
    });
    expect(order).toEqual(['alpha', 'beta']);
  });
});
```

## 安全

> **诚实声明**：以下能力**均未实现**——数字签名验证、依赖安全检查、运行时权限控制、配置验证白名单、路径访问限制、敏感信息脱敏。在 `packages/engine/src/plugin` 与 `built-in/mcp-plugin` 中 grep `permission` / `whitelist` / `redact` 零命中；`signature` 仅命中 `EnginePlugin.ts:112` 一条注释（指「hook 函数签名」，非密码学签名验证）。早期文档把它们写成已实现能力是不准确的。

实际存在的安全相关机制：

- **依赖校验**：插件 `dependencies` 在初始化时检查，缺失或循环依赖直接抛错阻止启动（`PluginManager.ts:159-168, 419-451`）。
- **错误隔离**：用户配置错误被捕获并记录，不中断引擎（`PluginManager.ts:335-375`）；引擎插件错误则向上抛出。
- **环境变量替换**：`ConfigVariableResolver` 支持 `${VAR}` / `${VAR:-default}`，避免把密钥硬编码进配置文件（`UserConfigPlugin.ts:153-183`）。
- 运行时密钥（`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` 等）走环境变量，详见根 `AGENTS.md` §7。

如需签名校验、沙箱执行、权限管控，需另行实现——目前仓库不提供。

## 部署与分发

- 仓库包管理器是 **pnpm**（`pnpm@10.28.0`），不要用 `npm publish`。
- 不存在 `coder-plugin` CLI（`create` / `validate` / `dev` 子命令均未实现）。仓库仅提供 `pulse-coder`（`packages/cli`）、`pulse-canvas`（`packages/canvas-cli`）、`pulse-teams`（`apps/teams-cli`）三个 bin。
- 不存在 `.coder/templates/` 或 `.pulse-coder/templates/` 目录。
- 分发引擎插件的方式：通过 `EngineOptions.enginePlugins.plugins` 直接传入，或放入扫描目录 `.pulse-coder/engine-plugins/`（优先）。
- 分发用户配置的方式：通过 `userConfigPlugins.configs` 传入，或放入 `.pulse-coder/config/`（优先）。

## 迁移

`scanLegacySkills()` / `convertToUserConfig()` 这两个迁移辅助函数在 `packages/` 中不存在（grep 零命中）。

仓库中「运行时技能」（`.pulse-coder/skills/*/SKILL.md`，由 skills 内置插件加载）与用户配置中的 `skills.directories` 是两套独立机制（根 `AGENTS.md` §8），没有自动迁移。如需把已有技能目录纳入用户配置，手动在 `skills.directories` 中列出即可。

## 现状

双轨插件系统已实现并接入 `Engine`（`Engine.ts:130-181` 构造 `PluginManager`、合并插件工具、收集钩子注入循环），9 个内置插件已随引擎发布。诚实的未完成项：

- 用户配置的 `tools` / `mcp.servers` / `subAgents` 落地尚未完成（见上文「错误处理与隔离」末尾的「未实现的子能力」）。
- 无 CI / git hook / 可执行 harness 校验（根 `AGENTS.md` §4），`harness/validate/validation.yaml` 是声明式规格，无自动运行。
- 同目录 `API-REFERENCE.md` / `EXAMPLES.md` / `ARCHITECTURE.md` 为早期设计草稿，内容已漂移，待清理或重写——以源码为准。
