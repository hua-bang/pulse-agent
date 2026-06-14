# 复杂度清单与优先级矩阵

范围：`apps/canvas-workspace` 当前工作区，统计日期 2026-06-14。

本清单只基于只读命令盘点 `src`、`docs`、`package.json`，不包含
`dist`、`release`、`node_modules` 或运行时状态目录。本文档不要求也不包含
运行时代码修改。

## 统计命令

```bash
rg --files src docs package.json | xargs wc -l | sort -nr
find src -maxdepth 2 -type d | sort
rg -n "import|export .* from|import\\(" src
rg -n "vitest|coverage|test:|describe\\(" . --glob 'package.json' --glob 'vitest.config.*' --glob 'src/**/*.test.ts' --glob 'src/**/*.test.tsx' --glob 'src/**/*.spec.ts' --glob '!node_modules'
```

## 总体规模

| 指标 | 数量 |
| --- | ---: |
| 统计文件总数 | 479 |
| 统计总行数 | 110,538 |
| `src` 文件数 | 473 |
| `src` 行数 | 108,956 |
| `docs` 文件数 | 5 |
| 测试文件数 | 45 |
| `.ts` 文件数 | 287 |
| `.tsx` 文件数 | 132 |
| `.css` 文件数 | 52 |
| 超过 500 行文件 | 42 |
| 超过 400 行文件 | 66 |

## 目录规模统计

`find src -maxdepth 2 -type d` 视角：

| 目录 | 文件数 | 行数 | 测试文件 | TSX | CSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| `src` | 473 | 108,956 | 45 | 132 | 52 |
| `src/renderer` | 272 | 65,221 | 1 | 128 | 50 |
| `src/renderer/src` | 271 | 65,208 | 1 | 128 | 50 |
| `src/main` | 118 | 30,159 | 24 | 0 | 0 |
| `src/plugins` | 66 | 12,840 | 20 | 4 | 2 |
| `src/main/agent` | 60 | 12,611 | 10 | 0 | 0 |
| `src/plugins/main` | 56 | 11,066 | 20 | 0 | 0 |
| `src/main/__tests__` | 10 | 4,373 | 10 | 0 | 0 |
| `src/main/agent-teams` | 8 | 4,331 | 1 | 0 | 0 |
| `src/main/canvas` | 8 | 3,499 | 0 | 0 | 0 |
| `src/main/runtime` | 4 | 1,523 | 1 | 0 | 0 |
| `src/plugins/renderer` | 9 | 1,501 | 0 | 4 | 2 |
| `src/main/app` | 10 | 826 | 0 | 0 | 0 |
| `src/main/webview` | 5 | 775 | 1 | 0 | 0 |
| `src/preload` | 16 | 627 | 0 | 0 | 0 |
| `src/main/files` | 3 | 605 | 0 | 0 | 0 |
| `src/main/settings` | 4 | 596 | 1 | 0 | 0 |
| `src/main/artifacts` | 2 | 455 | 0 | 0 | 0 |
| `src/main/terminal` | 1 | 363 | 0 | 0 | 0 |
| `src/shared` | 1 | 109 | 0 | 0 | 0 |

更细的热点目录，按行数排序：

| 目录/文件组 | 文件数 | 行数 | 测试文件 | `>400` 文件 |
| --- | ---: | ---: | ---: | ---: |
| `src/renderer/src/components/chat` | 37 | 9,506 | 0 | 7 |
| `src/main/agent` | 34 | 8,767 | 10 | 8 |
| `src/renderer/src/components/AgentTeamFrame` | 3 | 5,277 | 0 | 2 |
| `src/plugins/main/channel` | 24 | 5,162 | 9 | 5 |
| `src/main/__tests__` | 10 | 4,373 | 10 | 3 |
| `src/main/agent-teams` | 8 | 4,331 | 1 | 2 |
| `src/renderer/src/hooks` | 19 | 4,241 | 0 | 3 |
| `src/renderer/src/components/Canvas` | 18 | 3,954 | 0 | 1 |
| `src/renderer/src/components/AgentNodeBody` | 10 | 3,833 | 0 | 3 |
| `src/main/canvas` | 8 | 3,499 | 0 | 2 |
| `src/renderer/src/components/WorkspaceNodes` | 11 | 3,222 | 0 | 2 |
| `src/plugins/main/dynamic-app` | 17 | 3,056 | 7 | 3 |
| `src/renderer/src/components/CanvasNodeView` | 16 | 2,659 | 0 | 1 |
| `src/renderer/src/components/ReferenceDrawer` | 13 | 2,621 | 0 | 1 |
| `src/plugins/main/webview-page-control` | 8 | 2,345 | 3 | 2 |
| `src/renderer/src/components/Settings` | 12 | 2,273 | 0 | 0 |
| `src/renderer/src/components/Sidebar` | 11 | 2,215 | 0 | 1 |
| `src/renderer/src/utils` | 14 | 1,958 | 0 | 1 |
| `src/renderer/src/types.ts` | 1 | 1,861 | 0 | 1 |
| `src/renderer/src/components/IframeNodeBody` | 7 | 1,667 | 0 | 2 |

## 超过 500 行文件

| 行数 | 文件 |
| ---: | --- |
| 2,928 | `src/renderer/src/components/AgentTeamFrame/index.css` |
| 2,906 | `src/renderer/src/components/chat/ChatPanel.css` |
| 2,569 | `src/main/agent-teams/service.ts` |
| 2,229 | `src/renderer/src/components/AgentTeamFrame/index.tsx` |
| 1,861 | `src/renderer/src/types.ts` |
| 1,843 | `src/main/__tests__/agent-teams-service.test.ts` |
| 1,606 | `src/main/canvas/store.ts` |
| 1,495 | `src/renderer/src/i18n/messages.ts` |
| 1,393 | `src/renderer/src/components/AgentNodeBody/index.css` |
| 1,286 | `src/renderer/src/components/AgentNodeBody/useAgentNodeController.ts` |
| 1,260 | `src/main/__tests__/canvas-storage.test.ts` |
| 1,158 | `src/main/agent/canvas-agent.ts` |
| 1,122 | `src/main/canvas/storage.ts` |
| 1,096 | `src/renderer/src/components/CanvasNodeView/index.css` |
| 1,017 | `src/renderer/src/components/ReferenceDrawer/index.css` |
| 1,011 | `src/renderer/src/components/WorkspaceNodes/index.css` |
| 908 | `src/renderer/src/hooks/useNodes.ts` |
| 850 | `src/renderer/src/components/Sidebar/index.css` |
| 762 | `src/plugins/main/channel/channels/feishu/feishu-channel.ts` |
| 742 | `src/renderer/src/components/Canvas/index.tsx` |
| 739 | `src/main/agent-teams/canvas-nodes.ts` |
| 739 | `src/renderer/src/components/WorkspaceNodes/GraphPage.tsx` |
| 698 | `src/main/agent/context-builder.ts` |
| 685 | `src/main/runtime/control-server.ts` |
| 652 | `src/main/runtime/mcp-server.ts` |
| 612 | `src/renderer/src/components/settings-config/McpManager.tsx` |
| 604 | `src/renderer/src/App.tsx` |
| 603 | `src/renderer/src/utils/mindmapLayout.ts` |
| 599 | `src/main/agent/model/config.ts` |
| 593 | `src/plugins/main/dynamic-app/tools.ts` |
| 557 | `src/main/agent/session-store.ts` |
| 554 | `src/renderer/src/components/artifacts/artifacts.css` |
| 542 | `src/renderer/src/components/chat/hooks/useChatStream.ts` |
| 532 | `src/renderer/src/components/settings-config/settings-config.css` |
| 520 | `src/main/agent/service.ts` |
| 511 | `src/renderer/src/hooks/useFileNodeEditor.ts` |
| 510 | `src/renderer/src/components/icons/index.tsx` |
| 509 | `docs/architecture/main-structure-audit.md` |
| 509 | `src/plugins/main/channel/__tests__/bridge.test.ts` |
| 506 | `src/plugins/main/webview-page-control/js-primitives.ts` |
| 505 | `src/renderer/src/components/settings-config/SkillsManager.tsx` |
| 505 | `src/renderer/src/components/Workbench/index.tsx` |

## 400 到 500 行文件

| 行数 | 文件 |
| ---: | --- |
| 499 | `src/main/__tests__/agent-team-canvas-nodes.test.ts` |
| 499 | `src/renderer/src/components/IframeNodeBody/useIframeNodeState.ts` |
| 498 | `src/main/agent/skills/config.ts` |
| 494 | `src/plugins/main/dynamic-app/manager.ts` |
| 492 | `src/renderer/src/components/IframeNodeBody/index.css` |
| 491 | `src/renderer/src/components/chat/hooks/useMentions.ts` |
| 472 | `src/renderer/src/components/chat/ChatPageBody.tsx` |
| 470 | `src/plugins/renderer/devtools/AgentDebugPage.css` |
| 470 | `src/main/agent/tools/nodes.ts` |
| 463 | `src/renderer/src/hooks/useEdgeInteraction.ts` |
| 445 | `src/renderer/src/components/chat/utils/mentions.ts` |
| 442 | `src/plugins/main/channel/core/bridge.ts` |
| 441 | `src/plugins/main/dynamic-app/__tests__/tools.test.ts` |
| 438 | `src/main/agent/ipc.ts` |
| 435 | `src/plugins/main/channel/__tests__/commands.test.ts` |
| 433 | `src/plugins/main/webview-page-control/tools.ts` |
| 430 | `src/main/agent/__tests__/tools-graph.test.ts` |
| 427 | `src/renderer/src/components/AgentNodeBody/AgentPicker.tsx` |
| 421 | `src/renderer/src/components/RightDock/index.css` |
| 421 | `src/renderer/src/components/RightDock/index.tsx` |
| 417 | `src/renderer/src/components/chat/ChatPanel.tsx` |
| 408 | `src/renderer/src/components/chat/ChatMessage.tsx` |
| 405 | `src/renderer/src/components/EdgeStylePanel/index.tsx` |
| 404 | `src/plugins/main/channel/core/commands.ts` |

## 局部 import 热点

### 单文件本地导入过多

这些文件导入很多相对路径模块，通常是组合器、注册器或隐式领域入口。

| 本地唯一导入数 | 文件 |
| ---: | --- |
| 38 | `src/main/app/bootstrap.ts` |
| 32 | `src/renderer/src/components/Canvas/index.tsx` |
| 18 | `src/main/agent/tools/index.ts` |
| 18 | `src/renderer/src/App.tsx` |
| 15 | `src/preload/index.ts` |
| 15 | `src/renderer/src/components/Sidebar/index.tsx` |
| 14 | `src/renderer/src/components/Workbench/index.tsx` |
| 13 | `src/renderer/src/components/chat/ChatPageBody.tsx` |
| 12 | `src/renderer/src/components/chat/ChatPanel.tsx` |
| 11 | `src/renderer/src/components/Settings/index.tsx` |
| 11 | `src/renderer/src/components/CanvasNodeView/DefaultCanvasNode.tsx` |
| 11 | `src/renderer/src/components/chat/ChatMessage.tsx` |
| 10 | `src/main/agent/canvas-agent.ts` |
| 10 | `src/renderer/src/components/Canvas/CanvasOverlays.tsx` |
| 10 | `src/renderer/src/components/Canvas/CanvasSurface.tsx` |

### 被本地文件依赖最多的模块

这些模块是拆分时的主要兼容风险。优先保持兼容 re-export，避免一次性大迁移。

| 本地依赖方数量 | 文件 |
| ---: | --- |
| 150 | `src/renderer/src/types.ts` |
| 56 | `src/renderer/src/i18n/index.tsx` |
| 28 | `src/renderer/src/utils/ime.ts` |
| 27 | `src/plugins/types.ts` |
| 25 | `src/main/agent/tools/types.ts` |
| 24 | `src/renderer/src/components/icons/index.tsx` |
| 18 | `src/renderer/src/components/chat/types.ts` |
| 17 | `src/main/canvas/storage.ts` |
| 15 | `src/renderer/src/hooks/useWorkspaces.ts` |
| 13 | `src/renderer/src/components/AppShellProvider/index.tsx` |
| 12 | `src/main/canvas/nodes/store.ts` |
| 11 | `src/main/agent/tools/_shared/canvas-io.ts` |
| 11 | `src/renderer/src/utils/nodeLabel.ts` |
| 10 | `src/main/agent/types.ts` |
| 9 | `src/main/canvas/nodes/tags.ts` |

### 跨区域相对 import 热点

| 边 | 次数 | 风险含义 |
| --- | ---: | --- |
| `src/main/agent -> src/main/canvas` | 22 | agent 工具和上下文直接触达 canvas 存储/节点内部。 |
| `src/plugins/main -> src/plugins/types.ts` | 18 | 插件契约集中，改动需要保留类型兼容。 |
| `src/preload/index.ts -> src/preload/bridge` | 14 | preload 是明确的桥接聚合器，导入多但风险可控。 |
| `src/preload/bridge -> src/renderer/src` | 11 | preload 依赖 renderer 类型，跨层所有权倒置。 |
| `src/main/app -> src/main/agent` | 7 | bootstrap 按顺序装配 agent 能力，存在启动序耦合。 |
| `src/main/agent-teams -> src/main/canvas` | 5 | team 服务和布局直接依赖 canvas 写入/广播。 |
| `src/plugins/main -> src/main/canvas` | 5 | 内置插件绕过稳定 host capability。 |
| `src/main/agent -> src/main/webview` | 4 | agent 网页工具直接依赖 webview 内部。 |
| `src/plugins/main -> src/main/webview` | 4 | webview-page-control 插件直接依赖 webview/CDP 内部。 |
| `src/main/app -> src/plugins/main` | 3 | bootstrap 感知特定插件实现。 |

## 测试覆盖入口

可用入口：

| 入口 | 说明 |
| --- | --- |
| `pnpm test` | 当前 app 的测试脚本，执行 `vitest run`。 |
| `pnpm run typecheck` | `tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json`。 |
| `pnpm run typecheck:renderer` | 渲染进程 TypeScript 检查。 |
| `pnpm run typecheck:main` | 主进程 TypeScript 检查。 |

测试文件分布：

| 区域 | 测试文件数 |
| --- | ---: |
| `src/main` | 10 |
| `src/main/agent` | 8 |
| `src/plugins/main/channel` | 7 |
| `src/plugins/main/dynamic-app` | 7 |
| `src/plugins/main/webview-page-control` | 3 |
| `src/plugins/main/channel/channels/feishu` | 2 |
| `src/main/agent-teams` | 1 |
| `src/main/agent/mcp` | 1 |
| `src/main/agent/model` | 1 |
| `src/main/runtime` | 1 |
| `src/main/settings` | 1 |
| `src/main/webview` | 1 |
| `src/plugins/main` | 1 |
| `src/renderer/src/components/RightDock` | 1 |

覆盖缺口：

- renderer 大文件测试薄弱，只有 `RightDock` 有就近测试。
- `AgentTeamFrame`、`Canvas`、`chat`、`AgentNodeBody`、`WorkspaceNodes` 等高行数组件目前缺少组件级测试入口。
- `canvas/store.ts` 没有就近测试文件，但 `src/main/__tests__/canvas-store-merge.test.ts` 和 `canvas-storage.test.ts` 覆盖部分存储/合并行为。
- 没发现 coverage 脚本或 coverage 配置；当前清单只能说明测试入口和测试分布，不代表实际覆盖率。

## 风险/收益优先级矩阵

排序规则：先按运行时/架构风险降序，再按拆分收益降序。风险和收益均为 1-5 分。

| 优先级 | 目标 | 风险 | 收益 | 证据 | 建议拆法 | 回归入口 |
| ---: | --- | ---: | ---: | --- | --- | --- |
| 1 | `src/main/agent-teams/service.ts` | 5 | 5 | 2,569 行；team runtime、验证、心跳、队列、canvas 同步混在一个服务里。 | 保留 `CanvasAgentTeamsService` 门面，拆出 `planner`、`task-verifier`、`watchdog`、`handoff`、`runtime-launcher`、`canvas-sync`。 | `src/main/__tests__/agent-teams-service.test.ts`、`src/main/agent-teams/__tests__/store.test.ts`。 |
| 2 | `src/renderer/src/types.ts` | 5 | 5 | 1,861 行；150 个本地依赖方；preload 也依赖 renderer 类型。 | 先按兼容 re-export 拆成 `types/canvas.ts`、`types/api.ts`、`types/agent-teams.ts`、`types/artifacts.ts`、`types/view.ts`；第二步把跨进程契约迁到 `src/shared`。 | `pnpm run typecheck:renderer`、`pnpm run typecheck:main`。 |
| 3 | `src/main/canvas/store.ts` | 5 | 4 | 1,606 行；canvas 保存、合并、IPC、导入导出、watcher 和审计耦合。 | 保留公开 setup 函数，拆出 `store/ipc.ts`、`store/merge.ts`、`store/watchers.ts`、`store/export-import.ts`、`store/startup-audit.ts`。 | `canvas-store-merge.test.ts`、`canvas-storage.test.ts`、`workspaces.test.ts`。 |
| 4 | `src/main/canvas/storage.ts` | 5 | 4 | 1,122 行；17 个本地依赖方；schema、迁移、恢复、per-node I/O 集中。 | 拆成 `storage/paths.ts`、`json.ts`、`migration.ts`、`per-node.ts`、`recovery.ts`，用 `storage/index.ts` 兼容旧导入。 | `canvas-storage.test.ts`、`workspace-node-store.test.ts`。 |
| 5 | `src/main/agent/canvas-agent.ts` | 5 | 4 | 1,158 行；模型循环、prompt、工具流、会话、追踪和澄清逻辑耦合。 | 拆出 `runtime/run-loop.ts`、`prompt.ts`、`tool-events.ts`、`clarification.ts`、`trace.ts`，服务类只编排。 | `src/main/agent/__tests__/*`、`agent-session-send.test.ts`。 |
| 6 | `src/renderer/src/components/AgentTeamFrame/index.tsx` + CSS | 4 | 5 | TSX 2,229 行、CSS 2,928 行；无组件测试；UI 状态和展示层混合。 | 先拆 hook：`useAgentTeamFrameState`、`useAgentTeamActions`；再拆 `Toolbar`、`TaskList`、`AgentRoster`、`HandoffPanel`、`GatePrompt`；CSS 按子组件分文件。 | 建议新增组件级 smoke test；先跑 `typecheck:renderer`。 |
| 7 | `src/renderer/src/components/chat/*` | 4 | 4 | 9,506 行；`ChatPanel.css` 2,906 行；`useChatStream.ts` 542 行；无测试。 | 先拆样式为 layout/composer/messages/sessions；`useChatStream` 拆协议解析、状态 reducer、事件订阅。 | 建议新增 hook reducer 测试；现有入口为 `typecheck:renderer`。 |
| 8 | `src/renderer/src/hooks/useNodes.ts` | 4 | 4 | 908 行；canvas 节点 CRUD、排序、持久化、选择副作用聚合。 | 拆成 `useNodePersistence`、`useNodeOrdering`、`useNodeMutations`、`useLayerState`；保持原 hook 组合导出。 | 建议新增 hook 单测；现有入口为 `typecheck:renderer`。 |
| 9 | `src/plugins/main/channel/channels/feishu/feishu-channel.ts` | 4 | 3 | 762 行；外部通道、流式回复、卡片交互和会话绑定混合。 | 拆成 transport/client adapter、card actions、stream sender、message normalization；保持 channel 激活接口。 | `stream.test.ts`、`card.test.ts`、`channel/__tests__/*`。 |
| 10 | `src/main/runtime/control-server.ts` + `mcp-server.ts` | 4 | 3 | 685/652 行；HTTP/MCP 生命周期、认证、路由和产品能力调用耦合。 | 拆 auth、server lifecycle、route handlers、domain ports；先注入 agent/team/terminal 端口。 | `control-server.test.ts`，建议补 MCP route/handler 单测。 |
| 11 | `src/main/app/bootstrap.ts` | 4 | 3 | 本地导入 38 个模块；启动顺序隐含。 | 抽 `domain-lifecycle.ts`，把 setup/teardown 分阶段声明；bootstrap 只保留 Electron 生命周期。 | `typecheck:main`，建议新增启动注册顺序单测或快照。 |
| 12 | `src/plugins/main/dynamic-app/tools.ts` + `manager.ts` | 3 | 4 | tools 593 行，manager 494 行；测试较多但工具/状态/runner 聚合。 | 拆 tool schemas、tool handlers、spec validation、runner orchestration。 | `dynamic-app/__tests__/*`。 |

## 第一阶段建议先拆目标

第一阶段目标是降低最高风险文件的碰撞面，同时尽量保持 public API 和导入路径兼容。建议按下列粒度拆 8 个目标，不在同一 PR 中混拆主进程和 renderer UI 大件。

| 顺序 | 文件 | 第一阶段拆分粒度 | 原则 |
| ---: | --- | --- | --- |
| 1 | `src/main/agent-teams/service.ts` | 先提纯 `planner`、`task-verifier`、`watchdog` 三个无 UI 模块；服务类保留现有方法签名。 | 先拆纯逻辑和命令执行边界，避免同时改 canvas 布局。 |
| 2 | `src/main/canvas/storage.ts` | 建 `src/main/canvas/storage/`，拆 `paths/json/migration/per-node/recovery`，旧路径 re-export。 | 先保护 17 个依赖方，避免批量改 import。 |
| 3 | `src/main/canvas/store.ts` | 拆 merge/save 队列和 IPC 注册；`setupCanvasStoreIpc` 继续作为入口。 | 先隔离可测试 merge 逻辑。 |
| 4 | `src/renderer/src/types.ts` | 拆成 renderer 内部类型和跨进程 API 类型，暂时由原文件统一导出。 | 先做机械拆分，第二阶段再迁移到 `src/shared`。 |
| 5 | `src/main/agent/canvas-agent.ts` | 拆 prompt 构造、run loop、tool event streaming、trace 记录。 | 保持 `CanvasAgentService` 外部行为不变。 |
| 6 | `src/renderer/src/components/AgentTeamFrame/index.tsx` | 先抽 controller hook 和 3-5 个纯展示子组件；CSS 同步按组件分段。 | UI 拆分先不改交互语义。 |
| 7 | `src/renderer/src/components/chat/hooks/useChatStream.ts` | 抽 stream event reducer、session persistence adapter、订阅生命周期。 | 为后续 chat 面板拆分建立测试锚点。 |
| 8 | `src/plugins/main/channel/channels/feishu/feishu-channel.ts` | 抽 Feishu transport、card action parser、stream sender。 | 保持外部 channel 激活/配置接口不变。 |

可延后到第二阶段的目标：

- `src/renderer/src/components/chat/ChatPanel.css`、`AgentTeamFrame/index.css` 等 CSS 巨文件。它们行数最高，但运行时 API 风险低于 main/agent/canvas 核心。
- `src/main/app/bootstrap.ts`。导入热点最高，但最好等 domain facade 初步形成后再抽启动生命周期。
- `src/main/runtime/mcp-server.ts`。建议和 runtime ports 一起拆，避免先拆文件后仍直接调用各领域内部。

## Caveats

- 行数使用当前工作区文件内容统计，未排除注释、空行或测试 fixture。
- import 热点只解析静态相对导入、`export ... from` 和字符串字面量 `import()`；不解析 TS path alias、运行时动态拼接路径或类型系统实际引用图。
- 测试覆盖入口只统计 `*.test.ts`、`*.spec.ts` 和 `package.json` 脚本；未运行 coverage，因此不报告真实覆盖率百分比。
- 本文档是复杂度和优先级清单，不代表拆分已经实施。
