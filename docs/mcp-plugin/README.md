# MCP 插件实现方案

## 概览

基于 AI SDK 的轻量级 MCP (Model Context Protocol) 插件实现，仅支持 HTTP 传输和 JSON 配置。

## 项目结构

```
packages/mcp-plugin/
├── src/
│   ├── index.ts           # 插件入口
│   ├── config-loader.ts   # 配置加载
│   └── transport.ts       # 传输层
├── package.json
└── tsconfig.json
```

## 功能特性

- ✅ 仅支持 HTTP 传输
- ✅ 仅支持 JSON 配置格式
- ✅ 无热重载（启动时加载）
- ✅ 最小依赖
- ✅ 错误隔离

## 配置规范

### 配置文件路径

项目级配置：`.coder/mcp.json`

### 配置格式

```json
{
  "servers": {
    "server-name": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

### 配置示例

```json
{
  "servers": {
    "filesystem": {
      "url": "http://localhost:3000/filesystem"
    },
    "github": {
      "url": "http://localhost:3001/github"
    }
  }
}
```

## 实现步骤

### Phase 1: 项目初始化 (已完成)
- [x] 创建插件包结构
- [x] 配置 TypeScript 构建
- [x] 设置依赖关系

### Phase 2: 核心实现
- [ ] 实现配置加载器
- [ ] 实现 MCP 客户端创建
- [ ] 实现工具注册
- [ ] 错误处理机制

### Phase 3: 集成测试
- [ ] 创建测试配置
- [ ] 验证 HTTP 连接
- [ ] 测试工具调用

## 技术细节

### 1. 配置加载

```typescript
// 仅扫描 .coder/mcp.json
const configPath = path.join(cwd, '.coder/mcp.json');
```

### 2. 传输实现

```typescript
// 仅支持 HTTP
interface HTTPTransportConfig {
  type: 'http';
  url: string;
}
```

### 3. 工具注册

```typescript
// 注册格式：mcp:<server-name>:<tool-name>
// 例如：mcp:filesystem:read_file
```

## 使用方式

1. 在项目中创建 `.coder/mcp.json`
2. 配置 MCP 服务器 URL
3. 启动 Pulse Coder CLI，自动加载 MCP 工具

## 错误处理

- 配置文件不存在：静默跳过
- 配置文件格式错误：打印警告
- 服务器连接失败：单个服务器失败不影响其他
- 工具注册失败：记录日志

## OAuth 2.1 认证

HTTP / SSE 服务可声明 `auth: "oauth"` 以启用 MCP 授权流（基于 `@ai-sdk/mcp`
内置的 `OAuthClientProvider`：元数据发现、动态客户端注册、PKCE、令牌刷新）：

```json
{
  "servers": {
    "github": {
      "transport": "http",
      "url": "https://mcp.example.com",
      "auth": "oauth",
      "scopes": ["repo", "read:org"]
    }
  }
}
```

设计要点：

- **引擎与宿主解耦**：引擎只负责挂载 `authProvider` 并把「未授权」连接标记为
  `needsAuth`；打开浏览器、捕获回调由宿主提供。通过
  `MCPPluginOptions.createAuthProvider` 注入 provider。
- **令牌存储**：`createFileOAuthProvider` 将令牌 / 客户端注册信息 / PKCE verifier
  持久化到 JSON 文件，并支持注入 `OAuthCipher` 做静态加密。
- **后台连接不弹浏览器**：连接态 provider 的 `redirectToAuthorization` 为
  no-op，缺令牌时连接以 `UnauthorizedError` 失败并上报 `needsAuth`，由用户在设置里
  手动「登录」触发 `authorizeMcpServer` 完成授权码交换。

Pulse Canvas 的接入见
`apps/canvas-workspace/src/main/agent/mcp/oauth.ts`：系统浏览器 + 127.0.0.1
本地回调端口（RFC 8252），令牌经 Electron `safeStorage` 加密落盘。

## 扩展计划

### 后续版本可能添加
- YAML 配置支持
- 热重载功能
- 健康检查
- OAuth：预注册客户端（静态 client_id/secret）与自定义授权服务器元数据