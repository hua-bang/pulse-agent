# pulse-coder-cli

Pulse Coder CLI 是一个智能命令行助手，基于 `pulse-coder-engine` 构建。引擎自动加载内置 MCP、Skills、计划模式等插件，CLI 在其之上提供交互式终端宿主：默认 Ink UI（带 readline 回退）、会话持久化、斜杠命令、技能斜杠调用、模型切换与记忆集成。

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
- 会话按目录隔离 - 会话记录创建时的 cwd，`/sessions`、`/search`、`/resume` 选择器与 `--continue` 默认只看**当前目录**的会话；`/sessions --all` 查看全部（升级前的旧会话没有 cwd，始终可见）
- 模型记忆与默认值 - `/model` 的选择持久化到 `~/.pulse-coder/preferences.json`，重启自动恢复；models.json 条目可标 `"default": true` 作为新环境的默认模型
- 会话管理 - 保存与恢复对话（存储于 `~/.pulse-coder/sessions`），裸 `/resume` 弹出交互式选择器（过滤 + ↑↓），也支持序号/ID 前缀；`--continue` 启动即恢复最近会话；列表预览对含工具调用的结构化消息提取纯文本
- 滚动回看 - Ink 宿主把已完成输出写入终端原生 scrollback（Ink `<Static>`），长回答不截断、可随时上翻
- 工具透明 - 每个工具一行灰色留痕 + 行尾智能摘要（`· 350 lines` / `· 10 matches` / 错误首行标红），`Ctrl+O` 切换内容预览模式，永不 dump JSON
- 叙述分层 - 工具调用之间的过程叙述灰色显示，只有收尾的最终回答保持白色 + Markdown；状态行运行期稳定显示实耗时（`Running agent · 2m10s`），不随单个工具完成翻动
- 流式工具参数 - 模型开始生成工具调用时 live 区即出现该工具行，参数尾部实时增长，最终标签原位替换；并行工具结果按 callId 精确归位
- 状态栏密度 - `ctx ~46k (72%)` 上下文占比（窗口取引擎 `CONTEXT_WINDOW_TOKENS`，默认 64k）+ `cache 82%` 提示词缓存命中率（provider 上报 `cachedInputTokens` 时显示）+ `out ~3.4k` 累计输出 tokens；`/status` 另有单次/会话两级缓存命中明细
- 会话自动标题 - 默认标题的会话在首条消息后自动以消息内容命名（显式 `/new <title>` 不受影响）
- 压缩可见性 - 压缩真正开始时状态行变为 `Compacting context…`（engine `onCompactionStart` 回调），完成后打一行横幅（前后消息数 / tokens / 原因）；`/compact` 进入处理态，期间输入自动排队
- 模型切换 - `/model` 弹出选择器（候选来自 `.pulse-coder/models.json`）或 `/model <id>` / `/model claude:<id>` 直接切换、`/model reset` 回到 env 默认；`--model` 启动参数同理；状态栏常驻 `model <名>` 段
- 按模型配置上下文窗口 - models.json 条目可带 `contextWindow`（如 200000），切换后 `ctx %` 分母与 **engine 压缩阈值（75%/50%）** 一起跟随该模型，不再固定 64k；全局默认仍可用 `CONTEXT_WINDOW_TOKENS` 环境变量调整
- 输出分层 - 引擎/插件日志默认写入 `~/.pulse-coder/logs/cli.log` 不上屏（warn/error 以暗色单行显示），`/debug on` 或 `--verbose` 实时查看，`/debug tail <n>` 回看
- 轻量 Markdown 渲染 - 标题/加粗/行内代码/列表/代码块在终端中着色显示
- `@` 文件/文件夹引用 - 输入 `@` 弹出文件补全（尊重 `.gitignore`，跳过 node_modules/dist 等），`↑↓` 选择、`Tab`/`Enter` 插入；提交时把被引用的文件内容附在消息之后（目录则附目录清单），二进制/超限/越界自动跳过并提示
- 图片输入 - `@xx.png/jpg/webp/gif` 以视觉输入（base64 data URL）直接附给模型识别，不再当作二进制跳过；单图限 5MB，超限/空文件自动跳过并提示（需当前模型支持视觉）
- 粘贴剪贴板图片 - `/paste-image [描述]`（Ink 下也可 `Ctrl+Shift+V`）把系统剪贴板里的截图直接作为图片发给模型，绕过终端无法传输图片的限制（macOS 用系统自带 Swift 读取，Linux 需 `xclip`/`wl-paste`）
- 技能斜杠调用 - 运行时技能自动并入斜杠命令面，`/<skill-name> <message>` 直呼；内置命令优先，同名技能不会劫持
- 计划模式 - edit / plan 两档（`Shift+Tab` 或 `/mode` 切换），分别映射引擎 executing / planning；`/chat` `/auto` `/execute` 为兼容别名（均指向 edit）
- 非交互模式 - `pulse-coder -p "<prompt>"`（支持 stdin 管道）跑完即退，适合脚本/CI
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

### 命令行参数

```
pulse-coder                     # 交互式（默认 Ink UI）
pulse-coder -c | --continue     # 启动时恢复最近一次会话
pulse-coder -p "<prompt>"       # 非交互：跑一条 prompt，流式输出到 stdout 后退出
git diff | pulse-coder -p "review this"   # stdin 会拼接到 prompt 之后
pulse-coder --ui readline       # 指定 UI 宿主（ink / readline / plain）
pulse-coder --verbose           # 启动即实时显示引擎日志（等价 /debug on）
pulse-coder --model claude:claude-opus-5   # 启动即指定模型（等价 /model …）
# benchmark / CI：无持久状态、固定预算、JSONL 轨迹
pulse-coder -p --isolated --timeout 1200 --max-steps 100 --max-tokens 500000 \
  --output-format jsonl --trace-file ./trace.jsonl "fix the issue"
```

`-p` 文本模式下引擎/插件日志走 stderr，stdout 只包含回答文本，方便管道消费。`--output-format jsonl` 改为逐行输出 `run_start`、工具、step、压缩与 `run_end` 事件；`--trace-file` 可在文本或 JSONL 模式下额外保存同一轨迹。`--isolated` 关闭 memory、用户配置、外部插件扫描及会发现/持久化用户状态的内建插件，保留核心工具、plan-mode 和 CLI `run_js`，用于可重复的 benchmark 运行。文件系统、网络与进程树的硬隔离仍由 Harbor/SWE-bench 的每题容器负责。`--timeout 0` 可关闭 CLI 内部计时器；benchmark harness 仍应设置外层硬超时，避免 endpoint 永久挂起。超时退出码为 124，SIGINT/SIGTERM 分别为 130/143，token 或 step 预算耗尽为 2。

Harbor/SWE-bench 的自定义 agent、容器内本地源码安装和对比运行方法见 [`harness/tools/harbor/README.md`](harness/tools/harbor/README.md)。CLI 无需先发布到 npm；adapter 会上传当前已提交的 Git `HEAD`。

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

Ink 路径：`ink-launcher.tsx` → `ink-controller.ts` + `ink-app.tsx` + `ink-ui-bridge.ts`（及各自的 controller-*/composer-*/bridge 模块簇）。
readline 路径：`index.ts`（入口分发）→ `readline/readline-host.ts` + `tui-renderer.ts`。

两个宿主处理同一套斜杠命令；少量命令的参数形态因宿主而异（见下文命令参考注记）。

## 命令参考

输入以 `/` 开头视为斜杠命令。以下为命令清单（描述基于 readline 宿主的 `/help`；Ink 宿主行为对齐，个别命令参数略有差异）：

```
/help                       - 显示帮助
/new [title]                - 创建新会话
/resume                     - 交互式会话选择器（Ink 宿主：↑↓ 选择、Enter 恢复、Esc 取消、直接打字过滤）
/resume <index|id-prefix|id> - 按序号 / 唯一 ID 前缀 / 完整 ID 恢复（readline 宿主仅此形式）
/sessions [n] [--all]       - 列出当前目录最近 n 个会话（默认 20）；--all 列出所有目录
/search <query>             - 搜索会话
/rename <id> <new-title>    - 重命名会话
/delete <id>                - 删除会话
/clear                      - 清空当前对话
/compact                    - 强制压缩当前上下文
/skills [list|<name|index> <message>] - 单次以某技能运行一条消息
/<skill-name> <message>     - 直接以该技能运行一条消息（技能名来自运行时注册表）
/wt use <work-name>         - 通过 worktree 技能创建工作树与分支
/status                     - 显示会话状态
/mode                       - 显示当前模式（Ink 宿主: /mode [edit|plan] 设置模式）
/plan                       - 切换到计划模式
/execute                    - 切换到执行模式
/save                       - 显式保存当前会话
/tui [on|off|status]        - 切换或查看 TUI 渲染器（Ink 宿主: /tui [status] 查看 Ink 状态）
/debug [on|off|tail <n>]    - 引擎日志层：切换实时显示 / 回看最近 n 条（Ink 宿主）
/model [id|claude:<id>|reset] - 查看/切换模型；裸 /model 弹出选择器（Ink 宿主）
/exit                       - 退出并保存
```

控制键（Ink 宿主）：

- `Esc` - 处理中：中止当前响应；空闲：清空当前草稿（不会退出程序）
- `Ctrl+C` - 双击退出（首击清空草稿并提示，2 秒内再按一次保存退出）
- `Shift+Tab` - 切换 CLI 交互模式（edit ↔ plan，映射引擎 executing / planning）
- `↑/↓` - 历史输入（持久化于 `~/.pulse-coder/history.json`，跨会话保留）
- `Ctrl+J` - 草稿内换行；粘贴（含多行）原样插入，不会误触发送
- `↑/↓` - 多行草稿内按行移动光标；单行草稿时才切换历史
- `←/→`、退格/删除 - 按完整字符移动与删除（CJK、emoji 不会被劈开）
- `Ctrl+O` - 切换工具留痕详情（一行摘要 ↔ 内容预览；只影响之后的留痕）
- `@` - 文件/文件夹引用补全（`↑↓` 选择、`Tab`/`Enter` 插入路径）
- 处理中输入会排队，当前轮结束后自动执行

readline 宿主：处理中按 `Esc` 中止；`Ctrl+C` 立即保存退出。

### 已退役的命令

`/team`、`/teams`、`/solo`、`/acp` 及 `//` ACP 透传前缀已从命令面移除（输入时给出提示）。二者均未维护（直写 stdout 撕裂 Ink 画面、无中止支持），能力由 sub-agent 承接。`team-commands.ts` / `acp-commands.ts` 及 `pulse-coder-acp` 依赖保留，便于日后恢复。

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

### 模型候选配置（provider 粒度）

配置文件读取两个层级并**合并**（项目层同名条目覆盖全局层）：

| 层级 | 路径 | 用途 |
|---|---|---|
| 全局 | `~/.pulse-coder/models.json`（兼容 `~/.coder/`） | 常用 provider 与模型，任何目录下启动都可用 |
| 项目 | `<cwd>/.pulse-coder/models.json`（兼容 `<cwd>/.coder/`） | 该项目特有的模型，或覆盖全局同名条目 |

合并规则：provider 按名字覆盖（项目层赢，且全局层引用同名 provider 的模型会自动改用项目层连接）；模型按 `provider:model` 标识覆盖，项目层独有条目追加在后。只配全局层即可全机通用。

`providers` 定义连接（可同时挂多个 OpenAI 兼容源），`models` 引用它们：

```json
{
  "providers": {
    "deepseek":  { "type": "openai", "baseUrl": "https://api.deepseek.com/v1",     "apiKeyEnv": "DEEPSEEK_API_KEY" },
    "novita":    { "type": "openai", "baseUrl": "https://api.novita.ai/v3/openai", "apiKeyEnv": "NOVITA_API_KEY" },
    "anthropic": { "type": "claude" }
  },
  "models": [
    { "model": "deepseek-v4-flash", "provider": "deepseek",  "contextWindow": 128000 },
    { "model": "claude-opus-5",     "provider": "anthropic", "label": "Opus 5", "contextWindow": 200000 },
    "deepseek:deepseek-r2",
    "openai:gpt-5.2"
  ]
}
```

- `type` 是 SDK 通道（`openai` 兼容层 / `claude`），`baseUrl` + `apiKeyEnv` 组成连接；**密钥只能用 `apiKeyEnv` 引用环境变量名，内联 `apiKey` 会被忽略并警告**（本文件可进版本库）
- 字符串条目前缀可以是 provider 名（`deepseek:…`）或通道名（`claude:` / `openai:`）；`/model deepseek:任意模型` 也可直接引用 provider
- `contextWindow` 同时驱动状态栏 `ctx %` 与 engine 压缩阈值（75%/50%）
- `"default": true` 标记该条目为默认模型（多个只取第一个）
- 未配 `baseUrl`/`apiKeyEnv` 的条目沿用该通道的全局 env 连接；`apiKeyEnv` 指向的变量为空时回退到通道默认 key 并提示
- `"promptCacheKey": true`（provider 级，默认关）：为该 provider 的每个会话生成稳定的 64 位 SHA-256 路由 key（`provider+model+sessionId`），经 OpenAI 兼容通道以 `prompt_cache_key` 发送。适用于 Sub2API 这类多上游账号/多缓存节点的网关——没有稳定 key 时相同前缀也会被路由到不同缓存节点，命中率骤降。key 是路由亲和而非缓存隔离：`/resume` 恢复原 key，`/new`、切模型自然产生新 key，`/clear` 保留本会话 key；Claude 通道与未开启的 provider 完全不受影响
- 文件解析失败（JSON 语法错误等）不会中断启动，只在日志层提示一行并按空注册表处理
- OpenAI 通道走 Responses API——OpenAI 兼容网关需支持 `/responses`（与引擎既有行为一致）

### 模型选择优先级

启动时按以下顺序决定用哪个模型，越靠前越优先：

| 顺序 | 来源 | 是否持久化 |
|---|---|---|
| 1 | `--model <spec>` 启动参数 | 否（仅本次运行） |
| 2 | 上次 `/model` 的选择（`~/.pulse-coder/preferences.json`） | 是 |
| 3 | models.json 中标了 `"default": true` 的条目 | — |
| 4 | 环境变量（`ANTHROPIC_MODEL` / `OPENAI_MODEL` / `PULSE_*`） | — |

`/model reset` 会清除持久化的选择，回到第 3/4 层。若持久化的模型在当前 models.json 中已不存在（比如换了项目），会提示一行并回退到默认，不会报错。

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
    [runJsTool.name]: runJsTool // 来自 src/tools/sandbox
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
├── index.ts                  # 入口分发（arg parse → print / Ink / readline）
├── ui-mode.ts                # --ui/--tui/-p/--continue 与 PULSE_CODER_UI 解析
├── ink/                      # 默认 Ink 宿主（模块簇，每文件 <300 行）
│   ├── ink-launcher.tsx      #   Ink 启动（exitOnCtrlC: false，历史存储装配）
│   ├── ink-controller.ts     #   控制器装配 + 公共 API（委托 controller-* 模块）
│   ├── controller-*.ts       #   defs/model/pickers/dispatch/commands/run/session 各职责模块
│   ├── tool-payload.ts       #   AI-SDK 工具 payload 纯探测
│   ├── ink-app.tsx           #   门面 + 组件装配（类型与 composer 工具 re-export）
│   ├── ink-types.ts          #   共享类型、快照默认值、composer 常量
│   ├── composer-edit.ts      #   游标安全编辑与词导航
│   ├── composer-hints.ts     #   draft 行窗口、粘贴规范化、斜杠/picker 建议
│   ├── composer-actions.ts   #   composer 动作工厂（提交、历史翻页、退出）
│   ├── composer-keys.ts      #   编辑键处理（方向/词/删除/默认插入）
│   ├── app-input.ts          #   useInput 回调工厂（Ctrl+C、picker、tab 等）
│   ├── use-composer-layout.ts#   全部渲染派生值（行列预算、窗口、状态行）
│   ├── app-view.tsx          #   整帧 JSX（transcript、live 区、picker/composer）
│   ├── app-format.ts         #   状态行/token/时长格式化与 live 区行预算
│   ├── transcript-event.tsx  #   <Static> transcript 单块渲染
│   ├── ink-ui-bridge.ts      #   桥壳层（快照 + emit 节流，委托各组件）
│   ├── bridge-surface.ts     #   桥的薄消息面（抽象基类）
│   ├── live-run.ts           #   live 区运行态机（流式文本、工具行、abort 闩锁）
│   ├── event-log.ts          #   append-only 事件存储 + ·×N trace 合并
│   ├── event-text.ts         #   ANSI/fence/代理对安全的事件文本截断
│   ├── tool-input-format.ts  #   工具输入摘要（shell/路径压缩、工具分类）
│   └── tool-output-format.ts #   工具结果摘要/预览/错误检测
├── readline/                 # readline 回退宿主
│   ├── readline-host.ts      #   宿主装配 + 输入循环、Esc/SIGINT、会话保存
│   ├── command-surface.ts    #   命令表常量 + 斜杠输入路由
│   ├── host-commands.ts      #   handleCommand 分支 + /model
│   ├── host-context.ts       #   协作者接口 + 会话/模型恢复等宿主辅助
│   ├── agent-turn.ts         #   单条消息 → 一次引擎运行（摘要/保存/日志）
│   ├── tui-renderer.ts       #   渲染器（委托 format/spinner）
│   ├── tui-format.ts         #   ANSI/box/时长/工具输入纯格式化
│   └── tui-spinner.ts        #   动画状态行组件
├── print/
│   ├── print-mode.ts         # -p 非交互/benchmark 模式（隔离、预算、轨迹、信号处理）
│   └── benchmark-trace.ts    # 有界 JSONL 事件输出与 trace-file sink
├── commands/                 # 两个宿主共享的斜杠命令面
│   ├── session-commands.ts   #   会话斜杠命令（/resume 序号/前缀解析、resumeLatest）
│   ├── session-listing.ts    #   /sessions、/search 与恢复预览的打印层
│   ├── skill-commands.ts     #   /skills 命令
│   ├── team-commands.ts      #   /team、/teams、/solo（已退役，模块保留）
│   └── acp-commands.ts       #   /acp 子命令（已退役，模块保留）
├── models/
│   ├── model-registry.ts     # models.json 加载与双作用域合并
│   ├── model-spec.ts         # 注册表类型 + spec 解析/格式化
│   ├── model-run-options.ts  # 模型选择 → 引擎 run options（两宿主共用）
│   └── preferences.ts        # 用户偏好持久化（~/.pulse-coder/preferences.json，记住上次模型）
├── session/
│   ├── session.ts            # 会话存储（~/.pulse-coder/sessions）
│   └── history-store.ts      # 输入历史持久化（~/.pulse-coder/history.json）
├── tools/                    # 宿主工具注册
│   ├── runtime-tools.ts      #   两宿主共享的工具装配（run_js + 实验性 live-app 能力）
│   ├── canvas-runtime-tools.ts #  Pulse Canvas 能力适配器
│   └── sandbox/              #   run_js 沙箱执行（runner 构建为 dist/runner.cjs；protocol.ts 为双端 IPC 契约）
├── terminal/
│   ├── markdown.ts           # 轻量 markdown → ANSI 渲染
│   └── text-width.ts         # 终端显示宽度与码点级光标步进（CJK/emoji）
└── shared/                   # 跨宿主共享的引擎接线
    ├── tui-types.ts          #   两宿主共享的 TUI 数据类型
    ├── input-manager.ts      #   输入与 clarification 请求处理
    ├── file-reference.ts     #   @ 引用：索引、补全过滤、提交时内容注入
    ├── log-sink.ts           #   引擎日志层：console 捕获 → ~/.pulse-coder/logs/cli.log + /debug
    ├── usage-metrics.ts      #   引擎 step usage 抽取（状态行 token 统计）
    └── memory-integration.ts #   记忆插件装配与每轮记忆上下文
```

各 `*.test.ts` 与被测模块同目录，为对应的聚焦行为测试（`vitest run`）。

## 依赖

运行时依赖（`package.json` dependencies）：

- `pulse-coder-engine` - 核心引擎（内置 MCP、Skills 等插件）
- `pulse-coder-acp` - ACP 模式状态与路由
- `pulse-coder-agent-teams` - Teams 多智能体协作
- `pulse-coder-engine/orchestrator` - `/team` DAG 编排（engine 子路径导出）
- `pulse-coder-plugin-kit/memory` - 记忆插件（plugin-kit 子路径导出）
- `ink` / `react` - 默认 Ink UI 宿主

更多导航见本包 `AGENTS.md`。
