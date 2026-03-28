# Orchestrator 编排层计划

## 背景

当前 `agent-teams-plugin` 作为 engine 内置插件实现了基础的多 agent 协作能力，但存在以下限制：

- 编排逻辑耦合在 engine 层，职责边界不清晰
- 无法管理多个 Engine 实例的生命周期
- 不同 agent 无法使用不同模型/工具集
- remote-server / CLI / canvas-workspace 无法共用编排能力

长期目标是将编排逻辑提升为独立层，engine 回归"单 agent 执行器"的职责。

---

## 当前 agent-teams 现状（已完成）

### 能力
- DAG 任务图执行（`scheduler.ts`）
- 角色路由：`auto`（关键词）/ `all`（全角色）/ `plan`（LLM 动态规划）
- 并行执行：`reviewer` / `writer` / `tester` 在 `executor` 完成后并行
- Node 粒度 `instruction` 字段，支持差异化 prompt
- Artifact Store：节点产物写入本地文件，下游节点读取

### 已知局限
- 所有 agent 共用同一 engine 实例（同一模型/工具集）
- artifact 无 cleanup 逻辑
- 聚合策略只有 `concat`，缺少 `last` 等策略
- 整体仍在 engine 层，是临时方案

---

## 路线规划

### Phase 1：`packages/orchestrator`（核心编排层）

**目标**：从 engine 层解耦，成为独立 package，CLI / remote-server / canvas-workspace 均可接入。

核心职责：
- 管理多个 Engine 实例的生命周期
- 持有 TaskGraph 执行状态
- 跨 agent artifact 共享（升级现有 artifact-store）
- 统一执行状态事件流（`pending` / `running` / `success` / `failed`）

主要迁移内容（从 agent-teams-plugin 搬过来，去掉 EnginePluginContext 依赖）：
- `scheduler.ts` → 依赖 `OrchestratorContext` 而非 engine context
- `graph.ts` / `planner.ts` / `artifact-store.ts` 基本可直接复用
- `router.ts` 可继续保留在 engine plugin 作为 thin adapter

补充能力：
- 每个 TaskNode 可指定独立的模型 / system prompt / 工具集
- artifact cleanup（按 runId TTL 清理）
- 聚合策略扩展：`concat` / `last` / `summary`（LLM 汇总）

### Phase 2：`apps/canvas-workspace` 可视化层

**目标**：将 TaskGraph 映射为 Canvas 上的节点 + 边，支持可视化编排与实时执行监控。

新增节点类型：
- **Agent 节点**：显示角色名、运行状态、产物预览
- **连线/边**：表达 DAG 依赖关系

交互流程：
1. 用户在 Canvas 上拖拽 Agent 节点、连线定义依赖
2. 点击执行 → 调用 orchestrator
3. 节点状态实时更新（颜色/进度指示）
4. 节点产物可直接在 Canvas 上预览（File 节点联动）

与 engine 通信方案：
- 优先通过 remote-server HTTP API（`/internal/agent/run`）
- 或在 Electron main process 直接引入 orchestrator package

### Phase 3：remote-server / CLI 接入

将 `agent-teams-plugin` 降级为 thin adapter，核心逻辑迁移到 orchestrator。
remote-server 的 `agent-runner.ts` 可直接调用 orchestrator 而不是通过工具调用。

---

## 依赖关系

```
packages/engine          ← 单 agent 执行器，保持轻量
packages/orchestrator    ← 多 agent 编排，依赖 engine
apps/remote-server       ← 接入 orchestrator
packages/cli             ← 接入 orchestrator
apps/canvas-workspace    ← 可视化层，接入 orchestrator
```

---

## 近期待办

- [ ] 补全 artifact cleanup（TTL 清理 runId 目录）
- [ ] 聚合策略补充 `last`
- [ ] 初始化 `packages/orchestrator` 骨架
- [ ] 定义 `OrchestratorContext` 接口，替换 `EnginePluginContext` 依赖
- [ ] canvas-workspace 新增连线/边基础能力
- [ ] canvas-workspace 新增 Agent 节点类型
