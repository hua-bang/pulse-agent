# Round 2 实施结果与下一步

范围：汇总已接受的四个 Round 2 实施任务。本文只记录结果、证据、风险和下一步建议，不包含运行时代码改动。

## 总体结论

Round 2 已完成第一批结构治理护栏：

- import 边界检查已落地，可阻止 shared/renderer/main/preload 的新增反向依赖。
- renderer 巨型类型入口已拆成 `src/renderer/src/types/*` 与 `src/shared/*`，同时保留旧 `src/renderer/src/types.ts` 兼容入口。
- canvas 新增 service facade，最危险的 `canvas-agent:add-image-to-canvas` 直接写 `canvas.json` 路径已迁移。
- 400/500 行文件治理已落为 Vitest baseline 检查，可阻止新的或继续增长的 >500 行生产文件。

这轮更像“建立护栏与兼容层”，不是迁移终点。preload 类型依赖、plugin host direct import、多个 agent/agent-teams/runtime 对 canvas internals 的依赖仍需 Round 3 继续收口。

## 变更内容

### 1. import 边界检查

新增 `src/main/__tests__/import-boundaries.test.ts`：

- 使用 TypeScript AST 扫描 `src/**/*.ts(x)` 的 static import、export-from、dynamic import 和 `require()`。
- 约束 `src/shared/**` 不依赖 app-layer、Electron 或 Node runtime。
- 约束 renderer/plugin renderer 不导入 main/preload/Electron/Node runtime。
- 约束 main/plugin main 不导入 renderer/preload。
- 约束 preload 不导入 renderer/main，当前仅通过显式 allowlist 保留已有 type debt。

### 2. renderer 类型入口兼容拆分

修改 `src/renderer/src/types.ts`，从约 1,861 行降为 25 行兼容 barrel：

- 继续导出旧入口下的所有类型，保留 `Window.canvasWorkspace: CanvasWorkspaceApi`。
- 新增 `src/renderer/src/types/*`，按 domain 拆分 function-bearing bridge API 类型。
- 新增 `src/shared/*` JSON-safe DTO 模块，包括 canvas、agent-chat、agent-teams、artifacts、model-config、settings-config、app-info、channel-config、codex-sessions、files、web。
- `src/shared/experimental-features.ts` 新增 `ToolingInstallStatus`，合并原先跨层使用的安装状态 DTO。

### 3. canvas service facade 与直接写入迁移

新增 `src/main/canvas/service.ts`：

- 包装现有 `canvas/storage` 的 full read/write 和 `canvas/broadcast`。
- 导出 `STORE_DIR`、`canvasPath`、`loadCanvas`、`saveCanvas`、`appendImageNodeToCanvas`。
- `saveCanvas` 保留 agent tool 的 empty-node overwrite guard。
- `appendImageNodeToCanvas` 复用原 image node placement/title 默认值，并通过 `broadcastCanvasUpdate` 发出 `canvas:external-update`。

修改：

- `src/main/agent/ipc.ts`：`canvas-agent:add-image-to-canvas` 不再手写 `canvas.json` 或枚举 `BrowserWindow`，改调用 `appendImageNodeToCanvas`。
- `src/main/agent/tools/_shared/canvas-io.ts`：保留原导出形状，但内部委托到 `canvas/service.ts`。

新增 `src/main/__tests__/canvas-service.test.ts`，覆盖 image append 和 empty-write guard。

### 4. 400/500 行文件治理基线

新增 `src/main/__tests__/file-size-governance.test.ts`：

- `WARN_LINE_THRESHOLD = 400`：只记录 warning metadata。
- `HARD_LINE_THRESHOLD = 500`：硬门槛。
- `CURRENT_OVER_500_BASELINE`：记录当前 37 个 >500 行生产文件的接受基线。
- `DOCUMENTED_EXCEPTIONS`：当前豁免 `src/renderer/src/i18n/messages.ts`，理由是 locale message catalog。
- 检查规则：新生产文件不能超过 500 行；已有 >500 文件不能超过记录基线。

## 验证证据

| 任务 | teammate 运行命令 | 结果 |
| --- | --- | --- |
| import 边界检查 | `pnpm test -- src/main/__tests__/import-boundaries.test.ts` | 通过；Vitest 报告 47 个 test files、495 tests passed。 |
| renderer 类型拆分 | `pnpm run typecheck:renderer` | 通过。 |
| canvas service facade | `pnpm test -- src/main/__tests__/canvas-storage.test.ts src/main/__tests__/canvas-store-merge.test.ts src/main/agent/__tests__/tools-graph.test.ts` | 通过；Vitest 报告 48 个 test files、497 tests passed。 |
| canvas service facade 补充验证 | `pnpm test -- src/main/__tests__/canvas-service.test.ts`、`pnpm typecheck:main` | 均通过。 |
| 文件大小治理 | `pnpm test -- src/main/__tests__/file-size-governance.test.ts` | 通过；Vitest 报告 46 个 test files、494 tests passed。 |

共同 caveat：四个任务的 Pulse Canvas verify 都因 `/bin/sh` 环境找不到 `pnpm` 失败；teammate 在本地 workspace 重新运行对应命令均通过。

## allowlist 与兼容 wrapper

- `ALLOWED_PRELOAD_BOUNDARY_IMPORTS`：位于 `src/main/__tests__/import-boundaries.test.ts`，当前显式允许 12 个 preload -> `src/renderer/src/types` type import。测试会在 allowlist 过期时失败，后续迁移 preload import 时应逐条删除。
- `src/renderer/src/types.ts`：兼容 barrel，继续服务旧 import 路径并保留 `Window.canvasWorkspace` global augmentation。
- `src/renderer/src/types/*`：新的 renderer API 类型模块。部分模块直接 re-export `src/shared/*` DTO，同时保留 function-bearing bridge API 类型在 renderer 侧。
- `src/main/canvas/service.ts`：新 canvas facade，目前仍包装既有 storage/broadcast，而不是替换底层实现。
- `src/main/agent/tools/_shared/canvas-io.ts`：兼容 wrapper，保留 `STORE_DIR`、`BLANK_PAGE_URL`、`canvasPath`、`loadCanvas`、`saveCanvas`、`SaveCanvasOptions` 导出。
- `CURRENT_OVER_500_BASELINE`：文件大小治理 allowlist，当前记录 37 个 >500 行生产文件。
- `DOCUMENTED_EXCEPTIONS`：文件大小治理例外，目前只有 `src/renderer/src/i18n/messages.ts`。

## 剩余风险

1. preload 类型迁移未完成  
   `src/preload/index.ts` 和 11 个 `src/preload/bridge/*` 文件仍从 `src/renderer/src/types` 导入类型。Round 2 只是用 shared DTO 和 allowlist 建好迁移路径。

2. 文件大小 baseline 有待收紧  
   `src/renderer/src/types.ts` 已降到 25 行，但 `CURRENT_OVER_500_BASELINE` 仍保留旧的 `1861` 行基线。治理测试有意不因“文件变小但 baseline 未删”失败；Round 3 应主动清理该过期基线，避免 ratchet 失效。

3. canvas facade 覆盖范围仍窄  
   已迁移 `canvas-agent:add-image-to-canvas` 和 agent tools 的 `_shared/canvas-io`，但仍有多处非 canvas 域直接依赖 storage/nodes/store/tags，例如：
   - `src/main/agent/session-send.ts`
   - `src/main/agent/context-builder.ts`
   - `src/main/agent/tools/{workspace-nodes,knowledge,tagging,search}.ts`
   - `src/main/agent-teams/{canvas-nodes,service,store}.ts`
   - `src/main/runtime/mcp-server.ts`
   - `src/main/artifacts/ipc.ts`
   - `src/plugins/main/dynamic-app/*`

4. plugin host 边界还没强约束  
   import-boundary test 目前只实施最低跨层规则，把 `src/plugins/main/**` 视为 main-side code；它尚未禁止内置插件直接导入 `src/main/**` internals。

5. shared contract 只是第一步  
   DTO 已移入 `src/shared/*`，但 `CanvasWorkspaceApi` 和很多 function-bearing bridge API 仍在 renderer type 模块里。后续要决定 preload 是否直接依赖 shared-only API contract，还是新增独立 bridge contract 模块。

6. governance 仍依赖测试被执行  
   文件大小和 import 边界规则都已进入 Vitest，但如果某些 CI 路径只跑局部命令，就可能绕过治理测试。Round 3 应确认默认 CI/test command 覆盖这些测试。

## 推荐 Round 3 任务

1. 迁移 preload bridge 类型依赖  
   将 `CanvasWorkspaceApi`、各 API group interface 和跨进程 DTO import 从 `src/renderer/src/types` 改为 shared/bridge contract；逐条删除 `ALLOWED_PRELOAD_BOUNDARY_IMPORTS`。

2. 收紧文件大小治理 baseline  
   删除或降低已缩小文件的 baseline，优先清理 `src/renderer/src/types.ts: 1861` 这类过期记录；为 400-500 行 warning 输出建立可读报告或评审模板。

3. 扩大 canvas service facade 覆盖面  
   优先迁移 `agent/session-send.ts`、`agent/context-builder.ts`、agent knowledge/tag/search/workspace-node tools、`agent-teams/canvas-nodes.ts` 到 canvas facade 或 workspace-node facade。

4. 建立 workspace-node/tag facade  
   当前 knowledge/search/tagging 仍直接依赖 `canvas/nodes/store` 和 `canvas/nodes/tags`。建议新增 `canvas/nodes/service.ts`，统一 list/read/write/tag/broadcast 用例。

5. 加强 plugin host 边界  
   为 `dynamic-app`、`webview-page-control`、`channel` 所需宿主能力补 `MainCtx` capability 或 host adapter，再把 direct `src/main/**` import 纳入 allowlist/检查。

6. 开始主进程核心文件拆分  
   按总方案优先拆 `agent-teams/service.ts` 的 planning、verification、watchdog，再拆 `canvas/storage.ts` 和 `canvas/store.ts` 的兼容子模块。

7. 确认治理测试进入默认验证路径  
   确认 `pnpm test`、CI 和 Team verify 环境都能运行新增治理测试；同时修复 Team verify `/bin/sh` 找不到 `pnpm` 的环境问题，避免后续任务反复出现同类假失败。
