# Canvas Workspace 聊天 Memory 接入设计方案

> 状态：**设计评审稿（待评审，未写代码）**
> 目标读者：canvas-workspace 维护者
> 关联包：`pulse-coder-memory-plugin`（`packages/memory-plugin`）

## 1. 背景与目标

在 `apps/canvas-workspace` 的 agent 聊天中引入"记忆"能力：

- **检索（recall）**：在不同粒度上召回历史沉淀 —— **分会话（session）**、**workspace**、**全局（global）**。
- **沉淀（sediment）**：把每轮对话自动蒸馏成结构化记忆条目（偏好 / 规则 / 决策 / 修复 / 事实），跨会话长期可用。

**结论先行**：直接复用 `pulse-coder-memory-plugin`，**不改动该包本身**，只在 canvas 主进程侧新增一层很薄的"粒度编排"。`apps/remote-server` 已是该插件的生产级用例，可作参照。

---

## 2. 复用结论：memory-plugin 能力对照

| 需求 | 插件是否支持 | 说明 |
|---|---|---|
| 语义召回 | ✅ | `recall()` 向量 + 关键词混合打分（`service.ts:312`） |
| 离线 embedding | ✅ | 默认 `HashEmbeddingProvider`（零 API），可切 OpenAI |
| 自动蒸馏对话 | ✅ | `recordTurn(sourceType:'daily-log')` 抽取候选 + 去重 |
| 按身份硬隔离 | ✅ | `platformKey` 是硬分区，跨 key 永不可见（`service.ts:708`） |
| 分会话隔离 | ⚠️ 部分 | `scope='session'` 按 `sessionId` 隔离；但 `recall` 的 daily-log 是 **platformKey 全量**，需 canvas 侧按 `item.sessionId` 过滤 |
| 一次跨多粒度召回 | ❌ | 内置集成是"单 run context（单 platformKey + 单 sessionId）"，跨桶合并需 canvas 侧编排 |
| 全局粒度 | ✅（约定） | 用独立 `platformKey = canvas:global` 表达，单独召回再合并 |

### 关键语义（已核对源码）

1. **`platformKey` 硬隔离**：所有查询只在单个 `platformKey` 内（`isCandidateVisible` 第一行即 `item.platformKey !== platformKey → false`，`service.ts:707-725`）。
2. **`sessionId` 软子隔离**：仅对 `scope='session'` 生效；`daily-log` / `user` / `soul` 忽略它。
3. **`recall()` 只搜 `sourceType==='daily-log'`，且 platformKey 全量**（`service.ts:328`）。daily-log 条目自带 `sessionId` 字段，所以"分会话语义检索"可以靠 **召回后在 canvas 侧按 `sessionId` 过滤** 实现。
4. **召回默认开启**：`isSessionEnabled` 返回 `!== false`（`service.ts:113`），无需先手动 enable。
5. **召回返回的是"蒸馏后的记忆条目"，非逐字记录**。逐字历史仍由现有 `SessionStore` 的 `archive/` 承担（见 §6）。

---

## 3. 核心设计：粒度 → platformKey 映射（记忆桶模型）

把每个粒度表达为一个 **memory 桶（= 一个 `platformKey`）**：

```
canvas:ws:{workspaceId}   ← 该 workspace 全部 session 共享（workspace 粒度，且承载 session 粒度）
canvas:global             ← 跨 workspace 共享（全局粒度）
```

canvas 已有 `AgentScope = { kind:'workspace'; workspaceId } | { kind:'global' }`（`types.ts:20`），映射如下：

```ts
// apps/canvas-workspace/src/main/agent/memory/keys.ts （新增）
export function memoryKeysForScope(scope: AgentScope): {
  workspaceKey: string; // 承载 session + workspace 两个粒度
  globalKey: string;    // 全局粒度
} {
  if (scope.kind === 'workspace') {
    return { workspaceKey: `canvas:ws:${scope.workspaceId}`, globalKey: 'canvas:global' };
  }
  // 全局聊天 agent：workspace 级即全局级
  return { workspaceKey: 'canvas:global', globalKey: 'canvas:global' };
}
```

**为什么 session 和 workspace 共用一个桶**：因为 daily-log 条目自带 `sessionId`，"分会话"只是对同一桶召回结果做 `item.sessionId === current` 过滤即可。**好处：一次写入同时服务两个粒度，避免重复写**。全局粒度因为是硬分区，必须独立桶 + 独立召回。

### 三粒度的查询计划

| 粒度 | 召回调用 | 后处理 |
|---|---|---|
| `session` | `recall({ platformKey: workspaceKey, sessionId, query })` | `.items.filter(i => i.sessionId === sessionId)` |
| `workspace` | `recall({ platformKey: workspaceKey, sessionId, query })` | 不过滤 |
| `global` | `recall({ platformKey: globalKey, sessionId: '__global__', query })` | 不过滤 |
| `all` | 上述三者并集 | 按 §4.2 去重 + 重排 |

---

## 4. 数据流：写入（沉淀）与召回（检索）

### 4.1 写入策略

**每轮自动沉淀（session + workspace）**：在 `chat()` 写完 assistant 消息之后（`canvas-agent.ts:964-970` 之后）追加：

```ts
// 失败绝不阻断聊天
try {
  await canvasMemory.sedimentTurn({
    workspaceKey,                 // canvas:ws:{id} 或 canvas:global（全局 agent）
    sessionId,                    // this.sessionStore.getCurrentSession()?.sessionId
    userText: message,
    assistantText: responseText,
  });
} catch (err) {
  console.warn('[canvas-agent] memory sediment failed:', err);
}
```

`sedimentTurn` 内部即 `memoryService.recordTurn({ platformKey: workspaceKey, sessionId, userText, assistantText, sourceType: 'daily-log' })`。每轮蒸馏 0–6 条候选并按 `dedupeKey` 去重。

> **不需要** 开启插件的 compaction-write 策略：每轮 `recordTurn` 已覆盖沉淀，压缩时再写是冗余。

**全局写入 = 仅显式提升（已确认的产品决策）**：
默认绝不自动写 `canvas:global`。仅以下显式路径写入全局桶：

- **agent 工具** `canvas_memory_promote({ content, kind })`：当用户表达"以后/所有项目都……记住"时，模型主动调用 → 写 `globalKey`。
- **（Phase 2）UI 动作**：聊天卡片上的"提升为全局记忆"按钮 → IPC → 写 `globalKey`。

提升实现：`recordTurn({ platformKey: globalKey, sessionId:'__global__', sourceType:'explicit' })`（规则/资料类）或 `recordSoul`（人格类）。

### 4.2 召回与合并策略

`recall()` 返回的是"已按相关度排序、但不含分值"的条目列表。跨桶合并采用启发式：

1. 分别对需要的桶调用 `recall`（每桶 `limit ≈ 5`）。
2. 给每条打 `origin`（session / workspace / global）与桶内 `rank`（位次）。
3. 按 `id` 去重（同一条只保留 origin 最"近"的：session > workspace > global）。
4. 排序键：`pinned` 优先 → `granularityWeight[origin]`（默认 session 1.0 / workspace 0.8 / global 0.6，可配） × `位次衰减` → `updatedAt`。
5. 截断到 `limit`（默认 6）。

> 说明：因 `recall` 不回传原始分值，此处是位次级启发式；后续若需精确跨桶排序，可在 plugin 增加"返回分值"的能力（非本期）。

### 4.3 agent 如何拿到记忆：纯工具按需（已定）

> **决策**：采用「**纯工具按需**」—— 不把记忆内容自动注入 system prompt，agent 需要时自行调用 `canvas_memory_recall`。最省 token、最精准；代价是依赖模型主动判断何时检索。

canvas 的 `buildEngine()` 已是 `disableBuiltInPlugins: true` + 自定义插件列表（`canvas-agent.ts:675-685`），我们完全掌控注入方式。**不直接用插件内置的单-context 工具**（它们只能看一个桶），改为自定义工具（挂到 canvas tools 数组）：

- `canvas_memory_recall({ query, granularity?: 'session'|'workspace'|'global'|'all', limit? })` → 按 §4.2 fan-out 合并。
- `canvas_memory_record({ content, kind })` → 写 **workspace 桶**（agent 主动记，默认不进全局）。
- `canvas_memory_promote({ content, kind })` → 写 **global 桶**（显式提升）。
- 工具闭包捕获 `scope` 与 `getSessionId = () => this.sessionStore.getCurrentSession()?.sessionId`，**无需 AsyncLocalStorage / withRunContext**。

**不做**记忆内容的自动注入。仅在 system prompt 追加一小段「**工具使用策略**」（约 3–5 行，类似 plugin 的 `MEMORY_TOOL_POLICY_APPEND`，见 `integration.ts:36-44`），告诉 agent「有这几个记忆工具、何时该调」。这是**告知工具存在**、并非注入记忆内容，长度恒定、不随对话量增长 —— 纯工具模式下少了它，弱模型容易忘记检索。

---

## 5. 服务生命周期与单例

`vectors.sqlite` 是**单文件**，**进程内必须共享同一个 `FileMemoryPluginService` 实例**（多个 agent：各 workspace + 全局聊天，都走同一实例）。

```ts
// apps/canvas-workspace/src/main/agent/memory/canvas-memory-service.ts （新增）
import { homedir } from 'os';
import { join } from 'path';
import { createMemoryIntegrationFromEnv } from 'pulse-coder-memory-plugin';

let integration: ReturnType<typeof createMemoryIntegrationFromEnv> | null = null;

export async function initCanvasMemory(): Promise<void> {
  if (integration) return;
  integration = createMemoryIntegrationFromEnv({
    env: process.env,
    baseDir: join(homedir(), '.pulse-coder', 'canvas', 'memory'),
    pluginName: 'canvas-memory',
    pluginVersion: '0.0.1',
  });
  await integration.initialize();
}

export function getCanvasMemoryService() {
  if (!integration) throw new Error('canvas memory not initialized');
  return integration.service; // FileMemoryPluginService
}
```

- **存储位置**：`~/.pulse-coder/canvas/memory/`（与 canvas 其它状态同根，含 `vectors.sqlite` 与分层 JSON）。
- **embedding**：默认 hash（离线）；如设了 `MEMORY_EMBEDDING_API_KEY` 等环境变量则走 OpenAI（由 `createMemoryIntegrationFromEnv` 自动解析）。
- **初始化时机**：app 启动时调用 `initCanvasMemory()`（主进程 bootstrap）；或惰性首调初始化。
- **封装层**：再写一个 `canvas-memory.ts` 暴露 `sedimentTurn / recallAcrossGranularities / promoteToGlobal / recordWorkspace`，内部用 `getCanvasMemoryService()` + `memoryKeysForScope`，把 §3/§4 逻辑收敛在一处。

---

## 6. 与现有 SessionStore 的关系

| | SessionStore（现有） | memory-plugin（新增） |
|---|---|---|
| 内容 | **逐字**对话 + 工具帧 | **蒸馏**后的记忆条目 |
| 存储 | `~/.pulse-coder/canvas/{ws}/agent-sessions/`（`session-store.ts:23`） | `~/.pulse-coder/canvas/memory/` |
| 用途 | UI 渲染、会话恢复、归档浏览 | 语义召回、跨会话长期记忆 |
| 粒度 | 单会话（current）+ 归档 | session / workspace / global |

二者**并存互补**：SessionStore 负责"我那次到底说了什么"（逐字），memory-plugin 负责"我学到/约定了什么"（蒸馏）。本期不改 SessionStore；"逐字历史的全文检索"（如 `canvas_search_history` 扫 archive）列为后续可选项。

---

## 7. 模块 / 接口设计

### 新增文件

```
apps/canvas-workspace/src/main/agent/memory/
├── keys.ts                    # memoryKeysForScope(scope)
├── canvas-memory-service.ts   # 单例 integration + init + getService
├── canvas-memory.ts           # sedimentTurn / recallAcrossGranularities / promoteToGlobal / recordWorkspace
├── tools.ts                   # createCanvasMemoryTools({ scope, getSessionId })
└── index.ts                   # 汇总导出
```

### 改动文件

| 文件 | 改动 |
|---|---|
| `apps/canvas-workspace/package.json` | 加依赖 `"pulse-coder-memory-plugin": "workspace:*"` |
| `src/main/agent/canvas-agent.ts` | `buildEngine()`(:651) 合并 memory 工具；`chat()`(:811) 前轻量注入；`chat()`(:970 后) 调 `sedimentTurn` |
| `src/main/agent/service.ts` | 确保启动时 `initCanvasMemory()`（或在主进程 bootstrap 调用） |
| 主进程入口 | 启动时 `await initCanvasMemory()` |
| `src/main/agent/types.ts` | 如需，扩展 config（可选，工具走闭包则无需） |

### 工具签名（草案）

```ts
canvas_memory_recall: {
  input: { query?: string; granularity?: 'session'|'workspace'|'global'|'all'; limit?: number };
  // 默认 granularity='all', limit=6；query 缺省用本轮用户消息
}
canvas_memory_record:  { input: { content: string; kind?: 'preference'|'rule'|'fix'|'profile' } } // → workspace 桶
canvas_memory_promote: { input: { content: string; kind?: 'rule'|'profile'|'soul' } }             // → global 桶
```

---

## 8. 配置项

| 配置 | 默认 | 说明 |
|---|---|---|
| `baseDir` | `~/.pulse-coder/canvas/memory` | 记忆存储根 |
| `MEMORY_EMBEDDING_API_KEY` 等 | 未设 → hash 离线 | OpenAI embedding（可选） |
| `granularityWeight` | `{session:1.0, workspace:0.8, global:0.6}` | 跨桶合并权重 |
| 记忆获取方式 | **纯工具按需**（已定） | 不自动注入记忆内容；仅追加固定的工具使用策略文案 |
| 每轮自动沉淀开关 | on | 关闭后仅显式 `canvas_memory_record` |

---

## 9. 边界情况与风险

- **单 SQLite 句柄**：务必全进程共享一个 service 实例（§5）。
- **`sessionId` 可能为空**：`getCurrentSession()` 在 `startSession()` 前为 `null`，沉淀/召回前需 guard。
- **session 粒度依赖 canvas 侧过滤**：daily-log 在 plugin 内是 platformKey 全量，"分会话"靠 `item.sessionId` 过滤实现（已在 §3/§4.1 说明）。
- **全局桶是跨 workspace 共享**：必须坚持"仅显式提升写入"，避免噪音/串味（符合本期决策）。
- **不阻断聊天**：所有 memory 调用包 `try/catch`，失败仅告警。
- **召回无原始分值**：跨桶排序为位次级启发式（§4.2），可接受，后续可增强。
- **隐私**：记忆落本地磁盘，与现有 canvas 数据同一信任域，无新增外发（除非显式启用 OpenAI embedding）。

---

## 10. 分阶段落地计划

- **Phase 1（MVP，检索侧闭环）**
  - 加依赖 + 单例 service + `keys.ts` + `canvas-memory.ts`。
  - 每轮自动沉淀到 workspace 桶。
  - `canvas_memory_recall`（支持 session/workspace/global/all）+ 轻量注入。
  - `canvas_memory_promote`（全局显式提升）。
  - 单测 + 一个 tmp-dir 集成测试。
- **Phase 2（体验）**
  - UI：记忆面板、"提升为全局"按钮、pin/forget、会话记忆开关（IPC + preload + renderer）。
  - OpenAI embedding 配置打通。
- **Phase 3（增强）**
  - 逐字历史全文检索（扫 SessionStore archive）。
  - 跨 workspace 全局记忆的策展/清理。
  - 跨桶精确排序（plugin 回传分值）。

---

## 11. 测试方案（vitest）

- **单元**：`memoryKeysForScope` 映射；跨桶合并去重 + 重排；session 过滤正确性。
- **集成**（tmp `baseDir`）：
  1. 起一个 workspace `CanvasAgent`，跑 2 轮对话 → 断言 workspace 桶可召回上轮事实；session 过滤只返回本会话条目。
  2. `global` 桶在 `promote` 前为空，`promote` 后可召回。
  3. 全局聊天 agent（`kind:'global'`）读写直达 global 桶。
- 复用仓库标准：`pnpm --filter @pulse-coder/... test`。

---

## 12. 评审决策（已锁定）

1. **注入策略** → **纯工具按需**：不自动注入记忆内容，仅追加固定的工具使用策略文案。
2. **`canvas_memory_record` 归属** → agent 主动记**只写 workspace 桶**；进全局必须走 `canvas_memory_promote`。
3. **UI 入口** → Phase 1 **仅 agent 工具**（recall / record / promote）；记忆面板、提升按钮、pin/forget 等 UI 放 Phase 2。
4. **embedding 默认** → **离线 hash**（零依赖 / 零成本 / 不外发）；设 `MEMORY_EMBEDDING_API_KEY` 等环境变量则自动切 OpenAI。

---

*设计已锁定，将按 §10 Phase 1 与 §7 改动清单实现，并提交到 `claude/epic-ride-JXTQu`。*
