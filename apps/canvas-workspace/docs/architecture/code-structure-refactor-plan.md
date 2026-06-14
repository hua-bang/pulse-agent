# 代码结构重构总方案

范围：`apps/canvas-workspace` 当前代码结构。本文汇总主进程领域审计、renderer 组件与样式边界审计、preload/plugins/shared 跨层边界审计、复杂度清单与优先级矩阵，作为后续拆分工作的决策蓝图。

本文不要求运行时代码改动。目标是先确定分层、依赖方向、文件治理和迁移顺序，避免后续 PR 只是在大文件之间搬动复杂度。

## 决策摘要

推荐采用“先边界、再拆分、后清理”的路线：

1. 第一阶段建立共享契约、canvas facade、import 边界检查和兼容 re-export，优先降低跨层和存储写入风险。
2. 第二阶段拆主进程核心大文件与跨领域调用点，让 agent、agent-teams、canvas、runtime、plugins 通过稳定 facade 协作。
3. 第三阶段治理 renderer 组件/CSS 巨文件、删除兼容层、把 400/500 行文件规则固化到评审和 CI。

不建议第一步就大规模拆 CSS 或重写 UI 交互。`AgentTeamFrame/index.css` 和 `ChatPanel.css` 行数最高，但它们的运行时 API 风险低于 `src/renderer/src/types.ts`、canvas 存储写入路径、`agent-teams/service.ts` 和 main/plugin 跨域调用。

## 目标分层结构

目标结构按能力和进程边界划分，而不是按技术桶划分。

```text
src/
  shared/
    canvas-types.ts              # JSON-safe canvas DTO
    canvas-workspace-api.ts      # preload/renderer 共享 API 契约
    agent-team-types.ts          # team IPC DTO
    artifact-types.ts            # artifact IPC DTO
    web-read-types.ts            # webview/read DTO
    experimental-features.ts     # 已经健康的共享纯模块

  main/
    app/
      bootstrap.ts               # Electron 生命周期入口
      domain-lifecycle.ts        # 有序 setup/teardown phase
      registrations.ts           # 域注册清单，无业务逻辑

    canvas/
      service.ts                 # 对外安全用例 facade
      repository.ts              # storage facade
      storage/
        paths.ts
        json.ts
        migration.ts
        per-node.ts
        recovery.ts
        index.ts                 # 迁移期兼容导出
      store/
        ipc.ts
        merge.ts
        watchers.ts
        export-import.ts
        startup-audit.ts
      nodes/
        service.ts
        store.ts
        tags.ts
        ipc.ts

    model/
      config.ts                  # main-wide model/provider resolution
      ipc.ts                     # 如模型配置仍需 main 全局管理

    agent/
      runtime/
        canvas-agent.ts
        run-loop.ts
        prompt.ts
        tool-events.ts
        clarification.ts
        tracing.ts
      sessions/
        store.ts
        send.ts
      context/
        builder.ts
        formatter.ts
        readers.ts
      tools/
        registry.ts
        canvas/
        knowledge/
        media/
        web/
        sessions/
        shared/
      ipc.ts                     # 保持 IPC channel 名称不变

    agent-teams/
      planning/
        parse.ts
        graph.ts
        prompts.ts
      runtime/
        service.ts
        heartbeat.ts
        dispatch.ts
        session-health.ts
      verification/
        commands.ts
        results.ts
      canvas/
        nodes.ts
        layout.ts
      store.ts
      ipc.ts                     # CanvasAgentTeamsService 保持 public facade

    webview/
      capabilities.ts            # 给 agent/plugins/runtime 的语义能力 facade
      registry.ts
      reader.ts
      ensure-operable.ts
      cdp-session.ts

    runtime/
      control/
        server.ts
        auth.ts
        request.ts
        runtime-file.ts
        routes-agent.ts
        routes-teams.ts
      mcp/
        server.ts
        registration.ts

    files/
    artifacts/
    terminal/
    generation/
    settings/

  preload/
    index.ts
    bridge/
      app-info.ts
      store.ts
      workspace-nodes.ts
      file.ts
      pty.ts
      agent.ts
      agent-teams.ts
      artifacts.ts
      webview.ts
      settings.ts
      plugin.ts

  renderer/src/
    App.tsx
    components/
      Workbench/
      Canvas/
      AgentTeamFrame/
        hooks/
        parts/
        styles/
      chat/
        hooks/
        reducers/
        parts/
        styles/
      RightDock/
      ReferenceDrawer/
    hooks/
    types/                       # renderer-only view/component state
    plugin-ui/                   # 可选：renderer plugin 公共 UI surface

  plugins/
    types.ts                     # plugin host contract
    main/
      registry.ts
      host-capabilities.ts       # 可选：稳定 host adapter
      devtools/
      dynamic-app/
      webview-page-control/
      channel/
    renderer/
      registry.ts
      devtools/
```

关键原则：

- `main` 是 Electron/Node 能力和持久化策略所有者。
- `preload` 只做 capability adapter，不做业务策略和权限判断。
- `renderer` 只通过 `window.canvasWorkspace` 使用 main 能力，renderer 自己只拥有 UI、交互状态和展示模型。
- `shared` 只存 JSON-safe DTO、常量和纯函数。
- `plugins` 通过 `MainCtx`/`RendererCtx` 和稳定 host capabilities 接入宿主，不能把宿主内部模块当公共 API。

## 依赖方向

允许的依赖方向如下：

```text
src/shared         -> 无 app-layer imports
src/plugins/types  -> src/shared/types only

src/main           -> src/shared, src/plugins/main public entrypoints
src/preload        -> electron, src/shared, src/plugins/types
src/renderer       -> src/shared, src/plugins/renderer public entrypoints

src/plugins/main     -> src/plugins/types, src/shared, Node/Electron, MainCtx capabilities
src/plugins/renderer -> src/plugins/types, src/shared, React runtime, renderer plugin public UI
```

禁止或需要显式例外的方向：

- `src/preload/** -> src/renderer/**`：当前 preload 依赖 `src/renderer/src/types.ts`，应迁到 `src/shared/**`。
- `src/renderer/** -> src/main/**`、`src/renderer/** -> src/preload/**`、renderer 直接导入 Electron/Node。
- `src/main/** -> src/renderer/**`、`src/main/** -> src/preload/**`。
- `src/shared/** -> main/preload/renderer/plugins implementation`。
- `src/plugins/main/** -> src/main/**` 只能作为内置插件临时例外；新增能力应进入 `MainCtx` 或 host adapter。
- `src/plugins/renderer/** -> src/renderer/src/**` 只能导入已声明稳定的公共 UI 或 DTO surface。

IPC 与数据契约规则：

- 新 IPC 必须作为 `CanvasWorkspaceApi` 上的命名 domain method 暴露，不能新增裸 `invoke(channel, payload)` 逃逸口；唯一例外是现有 namespaced plugin bridge。
- main IPC handler 接受文件路径、进程控制、`webContentsId`、外部 URL、凭据、远程消息时，必须在 main 中做 payload shape 和权限/策略校验。
- 共享 DTO 默认必须 JSON-safe，不放 React 组件、class 实例、Electron 对象、函数或 Node handle。

## 400/500 行文件治理规则

复杂度清单显示当前超过 500 行文件 42 个，超过 400 行文件 66 个。后续治理建议把 400 行作为预警线，500 行作为生产文件硬门槛。

### 行数分层

| 区间 | 状态 | 治理要求 |
| --- | --- | --- |
| `<= 300` 行 | 正常 | 可正常演进，保持单一职责。 |
| `301-400` 行 | 观察 | 新增复杂分支前先检查是否已有可抽取 helper/hook/reducer。 |
| `401-500` 行 | 预警 | 允许短期存在，但新增功能 PR 必须同时说明拆分方向、owner、验收命令。 |
| `> 500` 行 | 超标 | 不应继续承载新功能；只允许修 bug、机械拆分、兼容迁移或有明确豁免。 |

### 400-500 行文件规则

1. `400-500` 行文件每次被功能性修改时，PR 描述必须包含“是否增加职责”的判断。
2. 如果新增的是同一职责内的小逻辑，允许合入，但要避免继续扩大 public surface。
3. 如果新增的是第二个职责，必须优先抽模块、hook、reducer、adapter 或 pure helper。
4. `400-500` 行文件不能再作为跨领域入口；入口文件应只做聚合和委派。
5. 对被依赖很多的文件，优先兼容 re-export，而不是一次性全量改 import。
6. CSS 文件到 `400-500` 行时必须按组件部件或状态层拆分，避免一个选择器文件同时拥有布局、主题、动画、响应式和子组件细节。
7. 测试文件可豁免硬性行数，但新增 fixture、场景和断言应优先抽 builder/helper，避免测试本身变成不可维护入口。
8. i18n message 文件和生成物可豁免，但需要标注为数据文件或生成产物，不纳入结构拆分优先级。

### 超过 500 行生产文件规则

- `>500` 行生产文件必须进入治理清单，标注拆分目标和阶段。
- 第一批优先治理运行时/架构风险高的文件：`agent-teams/service.ts`、`src/renderer/src/types.ts`、`canvas/store.ts`、`canvas/storage.ts`、`agent/canvas-agent.ts`。
- CSS 巨文件应在对应组件边界先稳定后再拆，避免纯样式拆分后仍被一个巨型 TSX 控制。

## 三阶段迁移计划

### 阶段一：边界固化与兼容拆分

目标：先建立 facade、shared contract 和 import 规则，让后续拆分有稳定落点。

建议项目：

1. 建立轻量 import-boundary 检查，至少覆盖 `preload -> renderer`、`renderer -> main/preload`、`shared -> app layer`。
2. 为 `src/renderer/src/types.ts` 做兼容拆分：先拆 `types/canvas.ts`、`types/api.ts`、`types/agent-teams.ts`、`types/artifacts.ts`、`types/view.ts`，原文件统一 re-export。
3. 把跨进程 API/DTO 迁到 `src/shared/**`，然后将 preload bridge 从 `src/renderer/src/types.ts` 改为依赖 shared contract。
4. 新增 `canvas/service.ts` 或 `canvas/repository.ts` facade，先迁移最危险的直接写入：`canvas-agent:add-image-to-canvas`。
5. 将 `agent/tools/_shared/canvas-io.ts`、`agent/context-builder.ts`、`agent/session-send.ts`、`agent-teams/canvas-nodes.ts` 逐步改用 canvas facade。
6. 从 `agent-teams/service.ts` 抽纯 planning、verification、watchdog，不改 `CanvasAgentTeamsService` public 方法。
7. 将共享模型配置移到 `src/main/model/config.ts`，`agent/model/config.ts` 暂时 re-export，打断 `generation -> agent -> generation` 循环。
8. 视主进程 owner 排期，抽 `app/domain-lifecycle.ts` 做启动 setup/teardown phase，但必须保持调用顺序不变。

验收标准：

- `pnpm run typecheck:main`、`pnpm run typecheck:renderer` 通过。
- 相关 main 测试通过：canvas storage/store、workspace node、agent tools、agent team service、model config。
- `rg` 检查不再出现新的 `preload -> renderer` 依赖；旧依赖只允许在迁移清单中短期存在。
- `agent` 和 `agent-teams` 对 `canvas/storage`、`canvas/store`、`canvas/nodes` 的直接 import 降到明确 allowlist。
- IPC channel 名称、`window.canvasWorkspace` 形状、存储路径不变。
- 所有拆分都保留原 public entrypoint 或 re-export，调用方可以分批迁移。

### 阶段二：核心领域拆分与能力适配

目标：在第一阶段 facade 成立后，拆主进程核心大文件和插件/运行时跨域调用。

建议项目：

1. 拆 `src/main/canvas/storage.ts` 为 `paths/json/migration/per-node/recovery`，保留 `storage/index.ts` 兼容旧导入。
2. 拆 `src/main/canvas/store.ts` 为 `ipc/merge/watchers/export-import/startup-audit`，保留现有 setup 入口。
3. 拆 `src/main/agent/canvas-agent.ts` 的 prompt、run loop、tool event streaming、clarification、trace。
4. 重组 `src/main/agent/tools/*` 为 canvas、knowledge、media、web、sessions 等 capability 文件夹，保持 tool name 和 schema 不变。
5. 新增 `webview/capabilities.ts`，让 agent webpage tools 和 webview 插件通过语义能力访问，而不是直连 registry/CDP/window-manager。
6. 拆 `runtime/control-server.ts` 为 server/auth/request/runtime-file/routes-agent/routes-teams，并通过注入 command ports 调用 agent/team。
7. 为 main plugins 增加稳定 host capabilities，减少 `dynamic-app`、`webview-page-control`、`channel` 对 `src/main/**` 内部的直接导入。
8. 将 settings 中的安装/执行副作用迁到 files/skills command surface，settings 只保留配置读写。

验收标准：

- `pnpm run typecheck:main` 通过。
- targeted tests 通过：`agent-teams-service.test.ts`、`agent-team-canvas-nodes.test.ts`、`canvas-storage.test.ts`、`canvas-store-merge.test.ts`、`workspace-node-store.test.ts`、agent tools/model/session 测试、runtime control-server 测试、plugin main 测试。
- `src/main/agent-teams/service.ts`、`src/main/canvas/storage.ts`、`src/main/canvas/store.ts`、`src/main/agent/canvas-agent.ts` 的核心生产文件降到 500 行以下，或已拆出明确子模块且剩余 facade 只做编排。
- `generation/html-generator.ts` 不再依赖 `agent/model/config`。
- 插件直接 import `src/main/**` 的例外有清单；新增插件能力必须走 `MainCtx` 或 host adapter。
- runtime route 文件不直接调用多个领域内部实现，只调用注入 command port。

### 阶段三：renderer 组件/样式治理与兼容层清理

目标：降低 renderer 大组件和 CSS 巨文件的碰撞面，删除迁移期兼容层，把治理规则固化。

建议项目：

1. 拆 `AgentTeamFrame/index.tsx` 为 controller hooks 和纯展示 parts：toolbar、task list、agent roster、handoff panel、gate prompt。
2. 按部件拆 `AgentTeamFrame/index.css`，与组件 parts 同步落目录。
3. 从 `chat/hooks/useChatStream.ts` 抽 stream reducer、session adapter、订阅生命周期，并补 hook/reducer 测试锚点。
4. 拆 `ChatPanel.css` 为 layout、composer、messages、sessions、状态/响应式样式。
5. 拆 `useNodes.ts` 为 persistence、ordering、mutations、layer state，原 hook 组合导出。
6. 按 renderer surface 规则治理全局 UI：左侧只扩展 `ReferenceDrawer`，右侧 preview 进入 `RightDock` tab，modal tier 使用统一 layer token。
7. 推出 renderer plugin 公共 UI surface，避免 renderer plugins 继续导入宿主内部 icon/types。
8. 删除阶段一/二保留的兼容 re-export 和旧路径 wrapper，前提是 import 检查和测试都已覆盖。

验收标准：

- `pnpm run typecheck:renderer` 通过。
- `AgentTeamFrame`、chat stream reducer、RightDock/ReferenceDrawer 相关组件或 hook smoke test 通过。
- renderer 生产 TS/TSX/CSS 文件新增改动后遵守 400/500 行规则；超标文件有明确豁免或治理任务。
- 无新增硬编码全局 z-index；全局 surface 使用 `--layer-*` token。
- 无新增顶层 drawer 容器：reference 类进入 `ReferenceDrawer`，右侧 preview 类进入 `RightDock`。
- 迁移期 re-export 删除后，`rg` 找不到旧路径 import。

## 推荐先做

第一批建议按以下顺序推进，单个 PR 保持小而可回滚：

1. import-boundary 检查和 shared contract scaffolding：先阻止新反向依赖继续扩散。
2. `src/renderer/src/types.ts` 兼容拆分：它有 150 个本地依赖方，也是 preload 反向依赖的源头。
3. canvas service facade，并迁移 `canvas-agent:add-image-to-canvas` 这个直接写 `canvas.json` 的路径。
4. `agent/tools/_shared/canvas-io.ts` 改用 facade，降低 agent tools 对 canvas storage/schema 的耦合。
5. `agent-teams/service.ts` 先抽 planning、verification、watchdog 三类纯逻辑，保留服务门面。
6. 共享模型配置迁到 `src/main/model/config.ts`，消除 generation/agent 循环。
7. `app/domain-lifecycle.ts` 作为低行为变化的启动顺序显式化 PR，可与上面 main facade 工作错峰进行。

## 建议暂缓

这些项目重要，但不建议作为第一批：

- 纯 CSS 巨文件拆分：先等 `AgentTeamFrame`、chat 面板的组件边界稳定，否则样式拆完仍会被巨型组件重新耦合。
- `src/renderer/src/i18n/messages.ts`：行数高但更像数据文件，除非要重做 i18n 加载策略。
- `runtime/mcp-server.ts` 单独拆分：应等 runtime command ports 设计清楚后和 control runtime 一起拆。
- 第三方插件通用化：当前插件多为内置插件，先治理 host capability，再决定是否做第三方隔离策略。
- 大规模重命名目录或删除 wrapper：必须等 import 检查、共享契约和调用方迁移完成。
- UI 交互语义重构：本文只讨论结构，Agent Teams 产品流或 chat 行为变更应另开设计和验收任务。

## 风险与回滚策略

| 风险 | 触发场景 | 降低风险方式 | 回滚方式 |
| --- | --- | --- | --- |
| IPC/API 破坏 | shared contract 迁移时改了 `CanvasWorkspaceApi` 形状 | 先 re-export，后迁移 import；不改 channel 名称和 payload | 恢复原 `src/renderer/src/types.ts` 导出，preload import 回退到旧类型路径 |
| canvas 数据写入回归 | agent/tools 改用 facade 时漏掉 merge、broadcast、per-node 规则 | facade 包装现有 storage/store 路径，不改存储目录和 schema | 将调用方 import 切回旧 helper；保留 facade PR 可单独 revert |
| 启动顺序回归 | 抽 `domain-lifecycle.ts` 时 setup/teardown 顺序漂移 | 原顺序逐行搬迁，phase 名称只做组织；补顺序快照或 rg 验证 | revert lifecycle PR；不影响后续 facade 和 shared 类型 PR |
| agent/team 行为漂移 | `agent-teams/service.ts` 或 `canvas-agent.ts` 拆分时混入行为修改 | 先抽纯函数和命令边界，保持 service facade 方法签名 | revert 单个子模块抽取 PR；入口 facade 仍保留 |
| 插件能力缺口 | direct import 改为 host capability 后遗漏内部能力 | 先建立 adapter，旧 direct import 作为 allowlist 例外短期保留 | 插件切回直接 import；保留 adapter 但不启用 |
| renderer UI 回归 | TSX/CSS 拆分导致布局、层级、keep-alive 失效 | 组件拆分先不改交互；RightDock/ReferenceDrawer 规则保持不变；补 smoke test | 恢复原组件/CSS import；子组件文件可留到后续重试 |
| 文件治理阻塞业务 | 400/500 行规则过早强制导致小修难合入 | 先作为 PR 模板/评审规则，第三阶段再 CI 硬化 | 将 CI gate 降级为 warning，保留治理清单 |

回滚总原则：

- 每个 PR 只完成一个边界或一个文件族，不把 main、renderer、plugins 的大拆分混在一起。
- 保留旧 entrypoint、旧 IPC channel、旧 storage path，删除兼容层必须独立成 cleanup PR。
- 结构迁移 PR 不做产品行为变更；行为变更必须另开任务和验收标准。
- 涉及持久化的改动默认不改 schema；如果未来必须 schema migration，需要独立备份、回滚和数据恢复方案。

## 后续执行建议

Team Lead 可把本蓝图拆成三类任务并行推进：

- 架构边界任务：shared contracts、import-boundary check、canvas facade、model config。
- 主进程拆分任务：agent-teams、canvas storage/store、agent runtime/tools、runtime control、plugin host capabilities。
- renderer 治理任务：AgentTeamFrame、chat stream/chat CSS、useNodes、RightDock/ReferenceDrawer surface 规则。

每个任务的完成定义都应包含：保留 public API、通过对应 typecheck/test、没有新增反向依赖、超标文件行数不继续上升。
