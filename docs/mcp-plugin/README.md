# MCP 插件

## 概览

Pulse Coder 引擎的内置 MCP (Model Context Protocol) 插件，基于 [`@ai-sdk/mcp`](https://github.com/vercel/ai) 实现。它在引擎 `initialize` 期连接配置的 MCP 服务器，把服务器暴露的工具注册进引擎工具表，供 agent 调用。

- 传输：`http`、`sse`、`stdio` 三种
- 配置：JSON，支持项目级与用户级合并
- 认证：可插拔的 OAuth `authProvider`
- 工具按需延迟加载（`deferTools`）与禁用（`disabledTools`）
- 错误隔离：单个服务器加载失败不影响其他

## 代码位置

这是一个内置引擎插件，**不是**独立的 `packages/mcp-plugin/` 包（该包不存在）。源码为单文件：

```
packages/engine/src/built-in/mcp-plugin/
├── index.ts           # 插件实现（导出 createMcpPlugin / builtInMCPPlugin）
└── index.test.ts      # vitest 用例
```

通过 `packages/engine/src/built-in/index.ts` 注册进 `builtInPlugins`，引擎启动时自动加载，无需手动注册：

```typescript
// packages/engine/src/built-in/index.ts
import { builtInMCPPlugin } from './mcp-plugin';
export const builtInPlugins = [builtInMCPPlugin, /* ...其他内置插件 */];
```

## 配置规范

### 配置文件路径

配置按以下顺序合并，**后者覆盖前者**（同名 server 以更具体的来源为准）：

1. `~/.coder/mcp.json`（legacy 用户级）
2. `~/.pulse-coder/mcp.json`（用户级）
3. `<cwd>/.coder/mcp.json`（legacy 项目级）
4. `<cwd>/.pulse-coder/mcp.json`（项目级，首选）

项目内推荐使用 `.pulse-coder/mcp.json`；`.coder/mcp.json` 仅作向后兼容。仓库实际配置见 `.pulse-coder/mcp.json`。

### 配置格式

顶层结构：

```json
{
  "servers": {
    "<server-name>": { "...": "见下" }
  }
}
```

每个 server 根据 `transport` 字段选择 http/sse 或 stdio 配置。`transport` 缺省时按 `http` 处理。

**http / sse**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `transport` | `'http'` \| `'sse'` | 是 | 传输类型 |
| `url` | `string` | 是 | MCP 端点 URL |
| `headers` | `Record<string, string>` | 否 | 自定义请求头 |
| `auth` | `string` | 否 | 认证方式标记，如 `'oauth'`，供宿主 `authProviderFactory` 判断 |
| `oauth` | `Record<string, unknown>` | 否 | OAuth provider 配置，原样透传给 `authProviderFactory` |
| `deferTools` | `boolean` | 否 | 为 `true` 时给注册的工具加 `defer_loading: true` |
| `disabledTools` | `string[]` | 否 | 被禁用的工具名（裸名，不带前缀） |

**stdio**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `transport` | `'stdio'` | 是 | 传输类型 |
| `command` | `string` | 是 | 子进程命令 |
| `args` | `string[]` | 否 | 命令参数 |
| `env` | `Record<string, string>` | 否 | 子进程环境变量 |
| `cwd` | `string` | 否 | 子进程工作目录 |
| `deferTools` | `boolean` | 否 | 同上 |
| `disabledTools` | `string[]` | 否 | 同上 |

> 字段类型与校验逻辑见 `index.ts` 的 `HTTPOrSSEServerConfig` / `StdioServerConfig` 与 `normalizeServerConfig()`；本表仅为概述，以源码为准。

### 配置示例

取自仓库实际配置（`.pulse-coder/mcp.json`）：

```json
{
  "servers": {
    "eido_mind": {
      "transport": "http",
      "url": "http://localhost:3060/mcp/server",
      "deferTools": true
    },
    "deepwiki": {
      "transport": "http",
      "url": "https://mcp.deepwiki.com/mcp",
      "deferTools": true
    },
    "twitter": {
      "transport": "stdio",
      "command": "/root/.local/bin/uv",
      "args": ["--directory", "/root/pulse-coder/.vendors/opentwitter-mcp", "run", "opentwitter-mcp"],
      "deferTools": true
    }
  }
}
```

## 技术细节

### 配置加载

`loadMCPConfig(cwd)` 读取并合并上述 4 个路径。插件选项 `MCPPluginOptions` 允许宿主覆盖默认行为：

```typescript
export interface MCPPluginOptions {
  configPaths?: string[];            // 显式指定按序合并的配置文件路径（后者覆盖前者）
  cwd?: string;                     // 默认路径集的根目录（仅当未提供 configPaths 时生效）
  authProviderFactory?: MCPAuthProviderFactory;
}
```

提供 `configPaths` 时跳过默认路径，直接按数组顺序合并（`loadMCPConfigFromPaths`）。

### 传输实现

| transport | 实现 |
|---|---|
| `http` / `sse` | 传给 `createMCPClient({ transport: { type, url, headers, authProvider } })`，由 `@ai-sdk/mcp` 内部处理 |
| `stdio` | `new Experimental_StdioMCPTransport({ command, args, env, cwd })`，来自 `@ai-sdk/mcp/mcp-stdio` |

### 工具注册

每个 server 的工具以命名空间前缀注册进引擎工具表：

```
mcp_<server-name>_<tool-name>
```

例如 server `filesystem` 的 `read_file` 工具注册为 `mcp_filesystem_read_file`。注意是下划线，不是冒号。

**`deferTools`**：为 `true` 时，注册的工具对象会被加上 `defer_loading: true`，供引擎按需加载（而非启动时全量拉取 schema）。仓库内 3 个 server 均启用。

**`disabledTools`**：数组中的工具**不会**注册进引擎工具表（agent 不可见、不可调用），但仍会出现在该 server 的状态里（`enabled: false`），供宿主展示与切换。`toolCount` 只计入已启用（已注册）的工具。

### 认证（OAuth）

http/sse 传输在创建时会调用宿主传入的 `authProviderFactory`（若有）：

```typescript
export type MCPAuthProviderFactory = (
  context: { serverName: string; config: HTTPOrSSEServerConfig },
) => OAuthClientProvider | undefined | Promise<OAuthClientProvider | undefined>;
```

约定上，配置 `auth: 'oauth'` 表示该 server 走 OAuth；工厂可据此返回一个 `OAuthClientProvider`（来自 `@ai-sdk/mcp`），插件将其作为 `authProvider` 挂到 transport 上。`oauth` 字段是原样透传给工厂的 provider 配置。

`OAuthClientProvider`、`OAuthClientInformation`、`OAuthClientMetadata`、`OAuthTokens` 以及 `auth`（重导出为 `mcpAuth`）由 `packages/engine/src/built-in/index.ts` 从 `@ai-sdk/mcp` 重新导出，供宿主直接使用。

### 管理服务

插件注册两个服务到引擎：

- `mcp:<server-name>` —— 该 server 的原始 MCP client，供其他插件调用。
- `mcp:__manager__` —— `MCPClientManager`，供宿主在重建 Engine 前统一关闭 client、查询状态：

```typescript
export interface MCPClientManager {
  closeAll(): Promise<void>;
  getStatuses(): Record<string, MCPServerStatus>;
}

export type MCPServerStatus =
  | { ok: true; toolCount: number; tools: McpToolInfo[] }
  | { ok: false; error: string };

export interface McpToolInfo {
  name: string;          // 裸工具名（不带 mcp_<server>_ 前缀）
  description?: string;
  enabled: boolean;      // false = 被 disabledTools 禁用，未注册进引擎
}
```

`getStatuses()` 返回的是上一次 `initialize` 时的快照，不会主动重新探测。

## 引擎重建要求

MCP 工具在 `initialize` 期**静态**注册进引擎工具表，没有 per-run 注入。因此配置变更后，必须由宿主重建 Engine 才能生效；重建前应先调用 `mcp:__manager__` 的 `closeAll()`（或插件 `destroy()`）关闭旧 client，避免 stdio 子进程 / 长连接泄漏。

> 相关约定见根 `CLAUDE.md` §6 的 MCP reload guard：`activateScope` 后再 reload，并强制重新 probe。

## 使用方式

1. 在项目根创建 `.pulse-coder/mcp.json`，按上面格式配置 servers。
2. （可选）在 `~/.pulse-coder/mcp.json` 配置用户级 server。
3. 启动引擎——`builtInPlugins` 会自动加载本插件并注册工具。

## 错误处理

- 配置文件不存在：静默跳过（返回空 servers）。
- 配置文件格式错误 / 缺少 `servers`：打印 `[MCP]` 警告，返回空 servers。
- server 配置非法（缺 `url` / `command`、字段类型不符等）：跳过该 server，状态记为 `{ ok: false, error }`。
- server 连接失败：单个服务器失败不影响其他 server；失败记入状态。
- client 关闭失败：打印 `[MCP]` 警告，继续关闭其余 client。

## 测试

`index.test.ts`（vitest）覆盖：

- `disabledTools`：被禁用工具不注册，但仍以 `enabled: false` 出现在状态中。
- 默认注册：未禁用时全部工具注册，`toolCount` 正确。
- OAuth：`auth: 'oauth'` 的 http server 会触发 `authProviderFactory` 并把返回的 provider 挂到 transport。

运行：

```bash
pnpm --filter pulse-coder-engine test
```

## 扩展计划

以下为尚未实现的方向（非承诺）：

- YAML 配置支持（当前仅 JSON）。
- 主动健康检查（`getStatuses()` 目前是 initialize 快照，不重新探测）。
- 配置文件监听与自动热重载（当前需宿主重建 Engine；`mcp:__manager__` 已为该流程提供 `closeAll`）。
