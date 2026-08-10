# Coding Agent 能力建设 Roadmap

> 基于对当前 Pulse Coder 实现与业界最佳实践的综合分析，规划 Coding Agent 的演进路线。

## 总览

```
Phase 1 (P0) ── 基础稳固     已完成 ✅ / 进行中 🔄
Phase 2 (P1) ── 核心扩展     近期目标
Phase 3 (P2) ── 高级能力     中期目标
Phase 4 (P3) ── 生产级成熟   长期目标
```

---

## Phase 1：基础稳固（P0）✅ 大部分已完成

> 目标：保证 Agent 的基础执行能力稳定可靠

### 1.1 Agent Loop 核心重构 ✅

| 能力 | 状态 | 文件 |
|------|------|------|
| `streamText` 替代 `generateText`（实时流式输出） | ✅ | `packages/engine/src/core/loop.ts` |
| 用 `finishReason` 替代 `checkLoopFinish`（消除 2x API cost） | ✅ | `packages/engine/src/core/loop.ts` |
| `AbortController` 中断支持（Ctrl+C 可中止） | ✅ | `packages/engine/src/core/loop.ts` |
| 错误分类 + 指数退避重试（429/5xx 自动重试） | ✅ | `packages/engine/src/core/loop.ts` |
| 工具输出截断（防止 context 爆炸，30K 字符上限） | ✅ | `packages/engine/src/tools/` |
| Step/Turn 限制（MAX_STEPS=100, MAX_TURNS=100） | ✅ | `packages/engine/src/config/index.ts` |

### 1.2 核心工具集 ✅

| 工具 | 状态 | 说明 |
|------|------|------|
| `read` | ✅ | 读取文件，支持行范围 |
| `write` | ✅ | 创建/覆盖文件 |
| `edit` | ✅ | 定向编辑现有文件 |
| `grep` | ✅ | 正则搜索文件内容 |
| `ls` | ✅ | 列出目录内容 |
| `bash` | ✅ | 执行 shell 命令 |
| `tavily` | ✅ | Web 搜索（研究能力） |
| `clarify` | ✅ | 向用户提出澄清问题 |

### 1.3 上下文管理 ✅

| 能力 | 状态 | 文件 |
|------|------|------|
| Token 计数与估算 | ✅ | `packages/engine/src/context/` |
| 自动触发压缩（75% 阈值） | ✅ | `packages/engine/src/context/` |
| LLM 摘要压缩旧消息 | ✅ | `packages/engine/src/context/` |
| 保留最近 6 轮（KEEP_LAST_TURNS） | ✅ | `packages/engine/src/config/` |
| 压缩失败时回退修剪策略 | ✅ | `packages/engine/src/context/` |

### 1.4 插件架构基础 ✅

| 能力 | 状态 | 文件 |
|------|------|------|
| `EnginePlugin` 接口定义 | ✅ | `packages/engine/src/plugin/` |
| `PluginManager` 插件发现与生命周期 | ✅ | `packages/engine/src/plugin/PluginManager.ts` |
| `UserConfigPlugin` 用户配置插件 | ✅ | `packages/engine/src/plugin/` |
| 项目级 + 用户级插件扫描路径 | ✅ | `.coder/engine-plugins/`, `~/.coder/engine-plugins/` |

### 1.5 会话管理 ✅

| 能力 | 状态 | 文件 |
|------|------|------|
| 会话 CRUD（创建/保存/加载/删除） | ✅ | `packages/cli/src/session/session.ts` |
| 会话持久化（`~/.coder/sessions/*.json`） | ✅ | `packages/cli/src/session/session.ts` |
| 会话列表与全文搜索 | ✅ | `packages/cli/src/commands/session-commands.ts` |
| CLI 命令（`/new`, `/resume`, `/sessions`, `/search`） | ✅ | `packages/cli/src/readline/readline-host.ts` |

---

## Phase 2：核心扩展（P1）🔄 近期目标

> 目标：完善 MCP、SubAgent、Skills 三大扩展能力

### 2.1 MCP 集成增强 🔄

**当前状态：** 已实现基础 HTTP transport MCP 集成

**待完善：**

```
MCP 能力清单
├── ✅ HTTP transport 连接 MCP 服务器
├── ✅ 自动工具发现（mcp_{server}_{tool} 命名空间）
├── ✅ 服务注册（context.registerService("mcp:name")）
├── 🔄 Stdio transport 支持（本地进程 MCP 服务器）
├── 🔄 MCP 服务器健康检查与重连机制
├── 🔄 MCP 工具调用超时配置
└── ❌ MCP Resources / Prompts 支持（MCP 协议完整实现）
```

**文件：** `packages/engine/src/built-in/mcp-plugin/index.ts`

**配置格式演进：**
```jsonc
// 当前 .coder/mcp.json
{
  "servers": {
    "filesystem": { "url": "http://localhost:3000" }
  }
}

// 目标：支持 stdio transport
{
  "servers": {
    "filesystem": {
      "transport": "http",
      "url": "http://localhost:3000"
    },
    "git": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-git"]
    }
  }
}
```

### 2.2 Sub-Agent 委托增强 🔄

**当前状态：** 已实现基础 agent 委托，支持 `.coder/agents/*.md` 配置

**待完善：**

```
Sub-Agent 能力清单
├── ✅ Agent 配置文件发现（.coder/agents/*.md）
├── ✅ 隔离上下文执行（不污染主 context）
├── ✅ 工具继承（sub-agent 可使用所有注册工具）
├── ✅ 内置 agents（test-writer, code-reviewer, doc-generator）
├── 🔄 Agent 执行结果结构化返回（JSON schema）
├── 🔄 并行 sub-agent 执行（多任务并发）
├── 🔄 Agent 间通信（结果传递给其他 agent）
└── ❌ Agent 嵌套调用深度限制（防止递归爆炸）
```

**文件：** `packages/engine/src/built-in/sub-agent-plugin/index.ts`

**并行执行设计（目标）：**
```typescript
// 主 agent 可以同时委托多个 sub-agent
const [testResults, docResults] = await Promise.all([
  testWriterAgent.execute({ task: "Write tests for auth module" }),
  docGeneratorAgent.execute({ task: "Generate API docs for auth module" })
]);
```

### 2.3 Skills 系统增强 🔄

**当前状态：** 已实现 SKILL.md 发现加载，6 个内置 skills

**待完善：**

```
Skills 能力清单
├── ✅ SKILL.md 发现（.coder/skills/, .claude/skills/, ~/.coder/skills/）
├── ✅ YAML frontmatter 解析（name, description, version, author）
├── ✅ 6 个内置 skills（branch-naming, code-review, deep-research, git-workflow, mr-generator, refactor）
├── 🔄 Skill 版本管理（semver，冲突解决）
├── 🔄 Skill 参数化（frontmatter 支持参数定义）
├── 🔄 Skill 组合（skill 可以引用其他 skills）
└── ❌ Skill 市场/注册表（社区贡献的 skills）
```

**文件：** `packages/engine/src/built-in/skills-plugin/index.ts`

**参数化 Skill 设计（目标）：**
```yaml
---
name: code-review
description: 对代码进行结构化审查
version: 1.0.0
parameters:
  language:
    type: string
    default: "typescript"
    description: 目标编程语言
  focus:
    type: enum
    values: [security, performance, readability, all]
    default: all
---
```

---

## Phase 3：高级能力（P2）❌ 中期目标

> 目标：新增 TODO/TASK 跟踪、死循环防护增强、安全审批机制

### 3.1 TODO/TASK 跟踪系统（新增）❌

**为什么需要：**
- 复杂编码任务涉及多个步骤，需要跟踪状态
- 用户需要实时看到任务进度
- 中断恢复时需要知道完成到哪里

**设计方案：基于插件 + 会话元数据**

```typescript
// packages/engine/src/built-in/task-tracking-plugin/index.ts

interface TaskItem {
  id: string;
  description: string;
  status: 'pending' | 'in-progress' | 'completed' | 'blocked';
  createdAt: number;
  completedAt?: number;
  blockedReason?: string;
  subtasks?: TaskItem[];
  dependencies?: string[];   // 依赖其他 task 的 id
}

export const TaskTrackingPlugin: EnginePlugin = {
  name: '@pulse-coder/task-tracking',
  version: '1.0.0',

  async initialize(context: EnginePluginContext) {
    const taskManager = new TaskManager();

    // 注册 4 个任务管理工具
    context.registerTool('todo_write', createTodoWriteTool(taskManager));  // 批量更新任务列表
    context.registerTool('todo_read', createTodoReadTool(taskManager));    // 读取当前任务列表

    // 为其他插件提供服务
    context.registerService('taskManager', taskManager);

    // 自动监听步骤完成，更新任务状态
    context.events.on('step:complete', async (step) => {
      await taskManager.syncWithSession(step);
    });
  }
};
```

**工具接口：**
```typescript
// todo_write：创建/批量更新整个任务列表
interface TodoWriteInput {
  todos: Array<{
    id: string;
    content: string;
    status: 'pending' | 'in-progress' | 'completed';
    priority: 'high' | 'medium' | 'low';
  }>;
}

// todo_read：获取当前任务列表
interface TodoReadOutput {
  todos: TaskItem[];
  summary: {
    total: number;
    completed: number;
    inProgress: number;
    pending: number;
  };
}
```

**会话元数据扩展：**
```typescript
// packages/cli/src/session/session.ts 扩展
interface Session {
  id: string;
  title: string;
  messages: SessionMessage[];
  tasks?: {                          // 新增
    items: TaskItem[];
    lastUpdatedAt: number;
  };
}
```

**CLI 显示效果：**
```
> 重构认证模块

📋 Task List:
  ✅ [1] 读取 auth.ts 分析现有结构
  🔄 [2] 识别可提取的公共逻辑（当前执行）
  ⏳ [3] 提取 validateToken() 到 utils/token.ts
  ⏳ [4] 更新 auth.ts 使用新工具函数
  ⏳ [5] 运行测试确认无回归

[2/5] 🔧 grep({"pattern": "validateToken", "path": "src/auth"})
```

### 3.2 Doom Loop 检测增强 🔄→❌

**当前状态：** 仅依赖 MAX_STEPS/MAX_TURNS 限制

**目标：** 添加相同工具调用检测

```typescript
// 在 packages/engine/src/core/loop.ts 增强
const recentToolCalls: Array<{ name: string; args: string }> = [];
const DOOM_LOOP_THRESHOLD = 3;

onStepFinish: (step) => {
  if (step.toolCalls?.length) {
    for (const tc of step.toolCalls) {
      recentToolCalls.push({
        name: tc.toolName,
        args: JSON.stringify(tc.args),
      });
    }

    // 保留最近 N 次调用
    if (recentToolCalls.length > DOOM_LOOP_THRESHOLD) {
      recentToolCalls.shift();
    }

    // 检查是否所有最近调用完全相同（工具名 + 参数）
    if (recentToolCalls.length === DOOM_LOOP_THRESHOLD) {
      const first = recentToolCalls[0];
      const allSame = recentToolCalls.every(
        tc => tc.name === first.name && tc.args === first.args
      );
      if (allSame) {
        options?.abortSignal && abort();
        return 'Doom loop detected: same tool called 3 times with identical arguments.';
      }
    }
  }
}
```

### 3.3 安全审批机制 ❌

**参考：** Codex 的 `ToolOrchestrator` 三阶段管道

**为什么需要：**
- `bash rm -rf`、`git push --force` 等危险操作需要用户确认
- 生产环境不能让 agent 随意执行破坏性命令

**设计：审批工作流**

```typescript
// 三阶段管道
// 1. 审批（Apply Policy → 提示用户）
// 2. 沙箱选择（None / Restricted）
// 3. 执行

interface ApprovalPolicy {
  autoApprove: string[];     // 自动批准的命令模式
  requireApproval: string[]; // 需要审批的命令模式
  alwaysBlock: string[];     // 始终阻止的命令模式
}

// .coder/security.json
{
  "autoApprove": ["git status", "git log", "cat", "ls", "grep"],
  "requireApproval": ["git push", "git reset", "rm", "chmod"],
  "alwaysBlock": ["rm -rf /", ":(){ :|:& };:"]
}
```

### 3.4 执行转向机制（Steering）❌

**当前状态：** 仅支持完全中止（AbortController）

**目标：** 支持执行中途改变方向，无需完全中止重新开始

```typescript
// 用户可以在 agent 执行过程中发送新指令
interface SteeringOptions {
  // 注入新的用户指令到当前执行中
  steer: (newInstruction: string) => void;

  // 暂停执行，等待用户确认后继续
  pause: () => Promise<void>;

  // 完全中止当前任务
  abort: () => void;
}
```

---

## Phase 4：生产级成熟（P3）❌ 长期目标

> 目标：可观测性、性能优化、多 Agent 协作、Web UI

### 4.1 可观测性与日志 ❌

```
可观测性能力
├── 结构化日志（每次工具调用、LLM 请求）
├── Token 用量追踪与统计
├── 任务完成时间分析
├── 错误率与重试率监控
└── OpenTelemetry 集成（Traces, Metrics, Logs）
```

**示例日志结构：**
```json
{
  "sessionId": "uuid",
  "step": 3,
  "event": "tool_call",
  "tool": "bash",
  "input": { "command": "npm test" },
  "durationMs": 3420,
  "tokenUsage": { "input": 1200, "output": 340 }
}
```

### 4.2 性能优化 ❌

```
性能优化方向
├── 工具调用结果缓存（相同文件路径 + 内容哈希）
├── 并行工具执行（无依赖关系的工具调用同时执行）
├── 增量上下文更新（只传递变化的 messages）
├── 模型路由（简单任务用小模型，复杂任务用大模型）
└── 预取（预测下一个可能的工具调用并提前执行）
```

**并行工具执行（目标）：**
```typescript
// 当 LLM 返回多个无依赖的工具调用时，并行执行
const toolResults = await Promise.all(
  toolCalls.map(tc => executeTool(tc))  // 并行而非串行
);
```

### 4.3 多 Agent 协作 ❌

**架构：Orchestrator + Worker 模式**

```
主 Orchestrator Agent
├── 拆解复杂任务为子任务
├── 分配给专门的 Worker Agents
│   ├── CodeWriter Agent（专注写代码）
│   ├── TestWriter Agent（专注写测试）
│   ├── Reviewer Agent（专注代码审查）
│   └── Documenter Agent（专注写文档）
├── 合并各 Agent 的输出
└── 解决冲突与依赖
```

**通信机制（目标）：**
```typescript
// Orchestrator 通过共享上下文进行协作
interface AgentMessage {
  from: string;      // agent 名称
  to: string;        // 目标 agent 名称，或 "all"
  type: 'task' | 'result' | 'clarification' | 'broadcast';
  content: any;
  sessionId: string;
}
```

### 4.4 Web UI ❌

```
Web UI 能力
├── 实时对话界面（WebSocket 流式输出）
├── 任务进度可视化（TodoWrite 组件）
├── 文件变更预览（diff 视图）
├── 工具调用历史展示（可折叠的 timeline）
├── 多会话管理（侧边栏）
└── 移动端适配
```

---

## 能力状态总览

| 能力 | 分类 | Phase | 状态 | 优先级 |
|------|------|-------|------|--------|
| Agent 循环（流式 + finishReason） | 核心执行 | P0 | ✅ | Critical |
| LLM 集成（OpenAI + Anthropic） | 核心执行 | P0 | ✅ | Critical |
| 错误处理 + 指数退避 | 核心执行 | P0 | ✅ | Critical |
| 上下文压缩（自动 + 摘要） | 上下文管理 | P0 | ✅ | Critical |
| 8 个内置工具 | 工具系统 | P0 | ✅ | Critical |
| 插件架构（发现 + 生命周期） | 扩展性 | P0 | ✅ | High |
| 会话管理（保存/恢复/搜索） | 用户交互 | P0 | ✅ | High |
| 交互式澄清（clarify 工具） | 用户交互 | P0 | ✅ | Medium |
| MCP 基础集成（HTTP transport） | 扩展性 | P0 | ✅ | High |
| Skills 系统（SKILL.md + 6 内置） | 扩展性 | P0 | ✅ | High |
| Sub-Agent 委托（.md 配置） | 扩展性 | P0 | ✅ | Medium |
| MCP Stdio transport | 扩展性 | P1 | 🔄 | High |
| Sub-Agent 并行执行 | 扩展性 | P1 | 🔄 | Medium |
| Skill 参数化 | 扩展性 | P1 | 🔄 | Medium |
| **TODO/TASK 跟踪系统** | 任务管理 | P2 | ❌ | Medium |
| Doom Loop 相同调用检测 | 安全可靠 | P2 | ❌ | High |
| 安全审批机制（危险命令确认） | 安全可靠 | P2 | ❌ | Medium |
| 执行转向机制（Steering） | 用户交互 | P2 | ❌ | Medium |
| 结构化日志 + 可观测性 | 生产成熟 | P3 | ❌ | Medium |
| 并行工具执行 | 性能 | P3 | ❌ | Medium |
| 多 Agent 协作框架 | 扩展性 | P3 | ❌ | Low |
| Web UI | 用户交互 | P3 | ❌ | Low |

**图例：** ✅ 已实现 | 🔄 进行中/近期 | ❌ 待规划

---

## 关键架构文件索引

| 文件 | 说明 |
|------|------|
| `packages/engine/src/core/loop.ts` | Agent 循环核心，流式执行，终止逻辑 |
| `packages/engine/src/Engine.ts` | 插件加载，工具合并，初始化编排 |
| `packages/engine/src/plugin/PluginManager.ts` | 插件发现，生命周期管理 |
| `packages/engine/src/built-in/mcp-plugin/` | MCP 集成，HTTP transport |
| `packages/engine/src/built-in/sub-agent-plugin/` | Sub-agent 委托执行 |
| `packages/engine/src/built-in/skills-plugin/` | Skills 发现与加载 |
| `packages/engine/src/context/` | Token 计数，上下文压缩 |
| `packages/engine/src/tools/` | 8 个内置工具实现 |
| `packages/cli/src/session/session.ts` | 会话持久化与管理 |
| `packages/cli/src/index.ts` | CLI 入口（分发 print / Ink / readline） |

---

## 下一步行动（Near-term Actions）

### 立即可做（本周）
1. **MCP Stdio transport**：扩展 `mcp-plugin` 支持本地进程 MCP 服务器
2. **Doom Loop 检测**：在 `loop.ts` 中添加相同工具调用检测
3. **Sub-agent 结果结构化**：为 sub-agent 返回值定义 JSON schema

### 短期目标（本月）
4. **TODO/TASK 插件**：实现 `task-tracking-plugin`，添加 `todo_write`/`todo_read` 工具
5. **Skill 参数化**：扩展 SKILL.md frontmatter 支持参数定义
6. **安全审批**：实现危险命令（`rm`, `git push`）的确认机制

### 中期目标（本季度）
7. **并行工具执行**：识别无依赖工具调用并并行执行
8. **结构化日志**：每次工具调用和 LLM 请求记录结构化日志
9. **多 Agent 协作**：实现 Orchestrator + Worker 多 agent 框架

---

*文档版本：1.0 | 最后更新：2026-02-13*
