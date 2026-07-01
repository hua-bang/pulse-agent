# pulse-coder-cli

Pulse Coder CLI 是一个智能命令行助手，基于 `pulse-coder-engine` 构建。引擎自动加载内置 MCP、Skills、计划模式等插件，CLI 在其之上提供交互式终端宿主：默认 Ink UI（带 readline 回退）、会话持久化、斜杠命令、ACP 模式、Teams 多智能体与记忆集成。

> 仓库约定与硬边界见根 `AGENTS.md` / `CLAUDE.md`；本文件仅作包级概述，不重复规则正文。

## 快速开始

仓库为 pnpm workspace，必须使用 `pnpm@10.28.0`（根 `package.json` 的 `packageManager`），不要使用 npm/yarn。

```bash
# 从仓库根安装依赖
pnpm install

# 构建 CLI 包（产物在 packages/cli/dist/）
pnpm --filter pulse-coder-cli build

# 启动（根脚本映射到本包）
pnpm start
```

`pnpm start` 等价于 `pnpm --filter pulse-coder-cli start`，运行 `node --enable-source-maps dist/index.cjs`。`dist/` 过期时需先 build。

## 功能特性

- 内置 MCP 支持 - 引擎自动加载，无需显式配置
- 内置 Skills 系统 - 智能技能识别与单次调用
- 会话管理 - 保存与恢复对话（存储于 `~/.pulse-coder/sessions`）
- ACP 模式 - CLI 内置 ACP 切换与路由，支持 `//` 前缀强制透传
- Teams 多智能体 - `/team` DAG 编排与 `/teams` 持续协作模式
- 计划模式 - `/plan`、`/execute` 切换交互模式
- 双 UI 宿主 - 默认 Ink，可回退 readline

## 使用示例

### 基本使用

```bash
# 构建后直接运行产物
./dist/index.cjs

# 或通过包 bin（package.json bin: pulse-coder -> ./dist/index.cjs）
pulse-coder
```

全局链接安装后得到的是 `pulse-coder` 命令（不是 `coder`）。

### 内置功能示例

MCP 功能（自动加载）：

```
> 使用 mcp_eido_mind_search 搜索一些信息
```

Skills 功能（自动加载）：

```
> 帮我生成一个分支名
# 会自动使用 branch-naming 技能
```

## UI 模式

CLI 默认使用 Ink 渲染宿主；当终端不支持或显式选择时回退到 readline 宿主。解析逻辑见 `src/ui-mode.ts`：

- `--ui <ink|readline|plain>` 或 `--ui=<...>` / `--tui` / `--tui=<...>` 命令行参数
- `PULSE_CODER_UI` 环境变量（`ink` / `readline` / `plain`）
- 未指定时默认 `ink`

Ink 路径：`ink-launcher.tsx` → `ink-controller.ts` + `ink-app.tsx` + `ink-ui-bridge.ts`。
readline 路径：`index.ts` + `tui-renderer.ts`。

两个宿主处理同一套斜杠命令；少量命令的参数形态因宿主而异（见下文命令参考注记）。

## 命令参考

输入以 `/` 开头视为斜杠命令。以下为命令清单（描述基于 readline 宿主的 `/help`；Ink 宿主行为对齐，个别命令参数略有差异）：

```
/help                       - 显示帮助
/new [title]                - 创建新会话
/resume <id>                - 恢复会话
/sessions                   - 列出所有会话
/search <query>             - 搜索会话
/rename <id> <new-title>    - 重命名会话
/delete <id>                - 删除会话
/clear                      - 清空当前对话
/compact                    - 强制压缩当前上下文
/skills [list|<name|index> <message>] - 单次以某技能运行一条消息
/wt use <work-name>         - 通过 worktree 技能创建工作树与分支
/status                     - 显示会话状态
/mode                       - 显示当前模式（Ink 宿主: /mode [chat|plan|edit|auto] 设置模式）
/plan                       - 切换到计划模式
/execute                    - 切换到执行模式
/team <task>                - 运行多智能体团队（默认 LLM 规划 DAG）
/team --route=auto <task>   - 使用关键词路由而非 LLM 规划
/teams <task>               - 运行 agent teams（进入 teams 模式以接收后续消息）
/teams <task> --concurrency N - 限制并行队友数
/teams <task> --cwd <dir>   - 指定队友工作目录
/solo                       - 退出 teams 模式，回到普通 agent
/save                       - 显式保存当前会话
/tui [on|off|status]        - 切换或查看 TUI 渲染器（Ink 宿主: /tui [status] 查看 Ink 状态）
/exit                       - 退出并保存
```

控制键：处理中按 `Esc` 中止当前响应并接受下一条输入；`Ctrl+C` 立即退出。

### ACP 模式

```
/acp status                   - 查看 ACP 状态
/acp on <claude|codex> [cwd]  - 开启 ACP
/acp cd <path>                - 切换 ACP 工作目录（重置 session）
/acp off                      - 关闭 ACP（支持时通过 session/close 关闭）
/acp sessions                 - 列出 agent 已知 session（若支持）
```

`//` 前缀：任何以 `//` 开头的输入会被去掉一个 `/` 后强制透传给 ACP agent（需先 `/acp on`）。例如 `//clear` 即把 `/clear` 发给 ACP；这是通用机制，不限于 `/clear`。

## 配置文件

### MCP 配置

创建 `.pulse-coder/mcp.json`（兼容 `.coder/mcp.json`）：

```json
{
  "servers": {
    "eido_mind": {
      "transport": "http",
      "url": "http://localhost:3060/mcp/server",
      "deferTools": true
    },
    "local_stdio": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
      "cwd": ".",
      "deferTools": true
    }
  }
}
```

### Skills 配置

在 `.pulse-coder/skills/<skill-name>/SKILL.md` 创建技能（`.coder/skills/` 为兼容路径，非首选）：

```markdown
---
name: my-custom-skill
description: 我的自定义技能
---

# 技能内容...
```

无技能时 `/skills` 会提示 `Add SKILL.md under .pulse-coder/skills/**/SKILL.md`。

## 环境变量

| 变量 | 说明 |
|---|---|
| `KEEP_LAST_TURNS` | `/compact` 压缩时保留的最近对话轮数，默认 `4` |
| `PULSE_CODER_UI` | UI 宿主：`ink`（默认）/ `readline` / `plain` |
| `PULSE_CODER_ACP_PLATFORM_KEY` | ACP 平台隔离 key；未设时回退到 `PULSE_CODER_MEMORY_PLATFORM_KEY`，再回退到 `cli:<user>` |
| `PULSE_CODER_ACP_USER` | ACP 平台 key 中的用户名（默认 `$USER` / `$LOGNAME` / `local`） |
| `PULSE_CODER_MEMORY_PLATFORM_KEY` | 记忆平台隔离 key（默认 `cli:<user>`） |
| `PULSE_CODER_MEMORY_USER` | 记忆平台 key 中的用户名（默认 `$USER` / `$LOGNAME` / `local`） |
| `PULSE_CODER_TASK_LIST_ID` | 任务列表绑定 ID；由会话元数据自动设置，一般无需手动配置 |
| `PULSE_CODER_DEBUG` | 设为 `1` 时 `start:debug` 构建保留 sourcemap、跳过压缩与摇树，并以 `--inspect` 启动 |

模型与各 Provider 密钥等运行时变量见根 `AGENTS.md` §7。

## 引擎集成

引擎（`pulse-coder-engine`）默认自动加载内置插件（MCP、Skills、计划模式、任务跟踪、子代理、teams、role-soul、ptc 等），CLI 无需显式声明。CLI 在此之上显式注册了记忆插件与 `run_js` 工具，并配置扩展插件扫描目录：

```typescript
const agent = new PulseAgent({
  enginePlugins: {
    plugins: [memoryIntegration.enginePlugin], // 额外插件；内置插件已自动加载
    dirs: ['.pulse-coder/engine-plugins', '.coder/engine-plugins', '~/.pulse-coder/engine-plugins', '~/.coder/engine-plugins'],
    scan: true
  },
  userConfigPlugins: {
    dirs: ['.pulse-coder/config', '.coder/config', '~/.pulse-coder/config', '~/.coder/config'],
    scan: true
  },
  tools: {
    [runJsTool.name]: runJsTool // 来自 pulse-sandbox
  }
});
```

如需禁用内置插件，可传 `disableBuiltInPlugins: true` 并显式提供所需插件（内置插件可从引擎导入，如 `builtInSkillsPlugin`、`builtInMCPPlugin`，或用 `createSkillsPlugin` / `createMcpPlugin` 自定义）：

```typescript
import { builtInSkillsPlugin, builtInMCPPlugin } from 'pulse-coder-engine';

const engine = new PulseAgent({
  disableBuiltInPlugins: true,
  enginePlugins: {
    plugins: [builtInMCPPlugin, builtInSkillsPlugin] // 只启用部分内置功能
  }
});
```

## 开发

### 环境要求

- 包管理器：`pnpm@10.28.0`（仓库硬边界，见根 `AGENTS.md` §2）
- TypeScript `^5.0.0`（devDependency）
- Node.js：仓库未锁定版本（无 `engines` / `.nvmrc`），参见根 `AGENTS.md` §2

### 脚本

```bash
pnpm --filter pulse-coder-cli build       # tsup 构建（产物 dist/index.cjs、dist/runner.cjs）
pnpm --filter pulse-coder-cli dev         # tsup --watch
pnpm --filter pulse-coder-cli test        # vitest run
pnpm --filter pulse-coder-cli start       # 运行构建产物
pnpm --filter pulse-coder-cli start:debug # PULSE_CODER_DEBUG=1 重新构建并以 --inspect 启动
```

本包当前没有 `typecheck` 脚本（见本包 `AGENTS.md` Local Constraints）；不要依赖 `pnpm --filter pulse-coder-cli typecheck`。

### 项目结构

```
src/
├── index.ts              # readline 宿主入口、命令循环、agent/ACP 路由、会话保存
├── ui-mode.ts            # --ui/--tui 与 PULSE_CODER_UI 解析
├── ink-launcher.tsx      # Ink 启动
├── ink-controller.ts     # Ink 宿主控制器（命令处理、ACP 路由、会话同步、队列输入）
├── ink-app.tsx           # Ink 渲染、输入合成、命令建议、历史、模式快捷
├── ink-ui-bridge.ts      # 运行时回调与 Ink UI 的事件/快照桥接
├── tui-renderer.ts       # readline 宿主渲染器
├── input-manager.ts      # 输入与 clarification 请求处理
├── session.ts            # 会话存储（~/.pulse-coder/sessions）
├── session-commands.ts   # 会话斜杠命令
├── skill-commands.ts     # /skills 命令
├── team-commands.ts      # /team、/teams、/solo 命令与 teams 会话
├── acp-commands.ts       # /acp 子命令、平台 key 解析、session 列举/关闭
├── memory-integration.ts # 记忆插件装配与每轮记忆上下文
└── sandbox-runner.ts     # run_js 沙箱执行（构建为 dist/runner.cjs；当前活动 CLI 路径未直接导入）
```

各 `*.test.ts` 为对应的聚焦行为测试（`vitest run`）。

## 依赖

运行时依赖（`package.json` dependencies）：

- `pulse-coder-engine` - 核心引擎（内置 MCP、Skills 等插件）
- `pulse-coder-acp` - ACP 模式状态与路由
- `pulse-coder-agent-teams` - Teams 多智能体协作
- `pulse-coder-orchestrator` - `/team` DAG 编排
- `pulse-coder-memory-plugin` - 记忆插件
- `pulse-sandbox` - `run_js` 工具执行器
- `ink` / `react` - 默认 Ink UI 宿主

更多导航见本包 `AGENTS.md`。
