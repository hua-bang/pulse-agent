# 性能专项执行计划(本期)

> 交接文档:任务卡自包含,执行者(人或 Coding Agent)无需全局上下文即可开工。
> 体系与指标口径见 `program.md`(SSOT);发现明细见 `../docs/performance-analysis-consolidated.md`(+round3,含 file:line 与修法);操作流见 `.pulse-coder/skills/perf-report/SKILL.md`。
> 计划制定于 2026-07-04,基线 commit `4c937bb`。

## 目标与完成判据

三个 Sprint 内:
1. 六专项全部有实测数据(看板无灰色专项);
2. CI 每 PR 跑体积门禁 + 计数器场景;
3. 7 个头部发现修复且收益被基线锁定:入口体积 4,618 → ≤1,500 KB、打字整数组替换 121 → <20、拖拽 91 → <10、隐藏工作区后台 repair 归零、会话持久化 O(全量) → O(增量)。

**统一工作流**(每个任务相同):改动 → 跑 `perf-report` skill 自验 → 对应告警消失/指标达标 → **同 PR 调整 `baselines.json`** → 看板即验收凭证。

## Sprint 划分

| Sprint | 任务 | 说明 |
|---|---|---|
| 1 | A1-A6 全部 + B1、B3、B5 | 测量轨与修复轨并行;B1/B3/B5 零依赖,第一天可三线开工 |
| 2 | B2、B4、B6 + C1 | B6 依赖 A5 结论;C1 依赖 A6 |
| 3 | B7、B8 + C2、C3 | 大改动置后;C2 依赖 A3 攒的历史 |

---

## WS-A 测量补全

### A1 · workspace 切换循环场景 + 堆斜率 〔M〕
- **目标**:回答"切 N 个 workspace 后内存是否只涨不落"(H1 守卫,内存专项北极星)。
- **做法**:`run-scenarios.mjs` 新增 `ws-cycle` 场景——用 `window.canvasWorkspace.store.save` 造 5 个 workspace,循环切换 ×3 轮回原点;每轮末经 CDP `HeapProfiler.collectGarbage` 强制 GC 后采 `performance.memory` 与 `app.getAppMetrics()` 合计 RSS;线性回归得斜率。collect-metrics 映射 `memory.ws_cycle.heap_slope` / `rss_slope`。
- **验收**:两指标出现在 report.json;看板④由灰变黄。
- **风险**:切换路由的驱动方式(hash 路由/侧栏点击)需试;GC 不彻底会虚高——连续两次 collectGarbage。

### A2 · main 侧 loop-delay 采样器 + 保存写字节计数 〔M〕
- **目标**:主进程专项北极星 `main.loop_delay_p99_ms`;B3/B4 的修复标尺。
- **做法**:新建 `src/main/perf/`(≤500 行/文件):`monitorEventLoopDelay` 采样器(`PULSE_CANVAS_PERF=1` 门控,镜像 renderer `__pulsePerf` 的 begin/dump 模式,经日志行或 IPC 供 harness 读取);I/O 计数器挂在 `canvas/nodes/store.ts` 的 `writeWorkspaceNode`(该文件有行数余量,`storage.ts` 已超基线勿加)与 `agent/session-store.ts` persist。
- **验收**:`main.loop_delay_p99_ms`、`main.canvas_save.files_written`、`main.session_persist.bytes_per_turn` 有值。
- **风险**:采样器自身开销——用 env 门控保证默认零成本。

### A3 · 场景 `--repeat N` 中位数 〔S〕
- **做法**:runner 循环执行取中位数,report 带 `runs` 与 `raw[]`(schema 已定,见 program.md §3)。
- **验收**:时间指标 `runs≥3`;波动告警在正常运行下不再误报。

### A4 · pan/zoom 场景 〔S〕
- **做法**:空白区 mousePressed+move(pan)、ctrl+wheel(zoom)各 3s;复用现有 mouse 辅助。
- **验收**:`interact.panzoom.inp_p95_ms` 有值(I-6/A4 守卫)。

### A5 · bundle treemap 归因 〔S〕
- **做法**:构建加 `rollup-plugin-visualizer`(或 sourcemap + source-map-explorer)产出 entry 内 per-dep KB;写入 `bundle.entry_dep_kb.<dep>`。
- **验收**:B6 的拆分顺序结论(哪个依赖最大)落在 report 里。

### A6 · `perf:all` 一键入口 〔S〕
- **做法**:串 build→perf:bundle→harness start --headless→scenarios→close→perf:dashboard,任一门禁失败 exit 1;无显示环境自动走 headless。
- **验收**:CI 可直接调用的单命令;本地一条命令出完整看板。

## WS-B 修复专项

### B1 · 修 I-1:文件节点每 keystroke 全文序列化 〔S-M〕★首发
- **背景**:round3 I-1(medium-high,已实证 121 替换/120 键)。`useFileNodeEditor.ts:276-297`:Tiptap onUpdate 每字符同步 `getMarkdown()` + `onUpdate(nodeId,{data:{content}})` → 整 nodes 数组替换;仅磁盘写有 1500ms debounce。
- **做法**:内存回写加 **200ms trailing debounce**(决策 #2;blur/unmount/手动保存时 flush,保证不丢内容);slash 探测已用局部 `textBetween` 不受影响。
- **验收**:告警「放大器仍在:打字」消失;`nodes_array_replace` max 132→**20** 并 PASS;打字帧超率@100 节点显著下降(A3 后用中位数确认)。
- **风险/回滚**:undo 粒度略变粗(200ms 内合并)——产品验收打字手感;单 commit 可回滚。

### B2 · 修 K-1:图片节点全分辨率解码 〔S+M〕
- **背景**:round3 K-1(medium)。`ImageNodeBody/index.tsx:43`:`<img>` 无 `decoding/loading/宽高`,无缩略图;chat 侧写法正确可对照。
- **做法**:第一步(S)补 `decoding="async"` + 宽高;第二步(M)落盘时生成节点显示尺寸缩略图 sidecar,lightbox 才加载原图。
- **验收**:看板 K-1 告警关闭;`memory.image.decoded_mb`(A1 后)下降一个量级。

### B3 · 修 J-2:隐藏工作区 team 轮询 〔S〕★首发
- **背景**:round3 J-2(medium)。`AgentNodeBody/index.tsx:125`(5s)与 `AgentTeamFrame/index.tsx:886`(15s)无可见性门控,每 tick 主进程 `withTeamLock` 跑 mutating repair,与 15s heartbeat 冗余。
- **做法**:接入 `routeActive/workspaceActive` 门控,隐藏时停轮询、恢复时立即 refresh 一次;主进程 heartbeat 已保证 team 推进。
- **验收**:隐藏工作区后 snapshot IPC 归零;`main.loop_delay_p99_ms`(A2 后)在多 team 挂后台时无周期尖峰。

### B4 · 修 J-1:会话持久化全量非原子重写 〔M〕
- **背景**:round3 J-1(medium,含写撕裂风险)。`agent/session-store.ts:95,511`;`canvas-agent.ts:1118` 循环逐条 addMessage 造成重叠写。
- **做法**:persist 加串行队列 + tmp+rename 原子写 + trailing debounce(参照 agent-teams store 的 persistQueue 模式);loadCrossWorkspaceSession 改批量赋值后单次 persist。
- **验收**:`main.session_persist.bytes_per_turn` 从 O(会话全量) 降为 O(本 turn 增量);并发写撕裂路径消除(补一个 loop.test 风格的回归测试)。

### B5 · 修 D1:welcome webview 占首屏 〔S-M〕★首发
- **背景**:D1(high)。`main/canvas/welcome-workspace.ts:205` 首启画布挂外部 URL live webview(沙箱截图可见其错误卡)。
- **做法**:默认渲染占位卡片,IntersectionObserver 进视口或 idle 后再挂真 webview。
- **验收**:`startup.welcome_webview_ms` 移出关键路径;冷启 dom-ready 不回归(A3 中位数对比)。

### B6 · C 维第一批:重依赖出 entry 〔M-L,依赖 A5〕
- **背景**:C1-C6(入口 4,618KB,目标 ≤1,500)。全仓唯一懒边界是 mermaid,模式可复制(`chat/utils/mermaid.ts`)。
- **做法**:按 A5 的归因结论排序,预期首批 = `DefaultCanvasNode` 的 xterm/tiptap body 改 `React.lazy+Suspense`(占位框 fallback)+ `electron.vite.config.ts` 加 `manualChunks`。
- **验收**:`bundle.entry_raw_kb` 下降并**同 PR 下调基线**;拆出的依赖从 bundle-boundaries 测试的 `EXPECTED_STATIC` 升入 `WATCHLIST`;keep-alive 画布功能无回归(97 个测试 + harness 冒烟)。

### B7 · 修 A2:拖拽几何 ephemeral 化 〔L〕(决策 #1:进专项)
- **背景**:A2(high,已实证 91 替换/90 步)。手势期每 pointer-move 走 `updateNode→setNodes` 全量替换。
- **做法**:手势期几何走 ephemeral 层(CSS transform/override map,`CanvasSurface` 已有 dragPreview 通道可扩展),pointer-up 一次性提交进 nodes 数组;对齐吸附/边跟随读 ephemeral 值。
- **验收**:拖拽 `nodes_array_replace` 91→**<10**(max 同步下调);拖拽 INP p95@100 节点显著下降;undo 仍是"一次拖拽一步"。
- **风险**:触点多(吸附、边、group 边界),建议放 Sprint3 且 B1 经验先行;回滚为单 feature branch。

### B8 · H1 一期:LRU 驱逐挂载 workspace 〔M,依赖 A1〕
- **背景**:H1(high)。`useMountedWorkspaceIds.ts:11` 只增不减,内存随访问数单调增长。
- **做法**:LRU 上限 active+K(K=3),驱逐即卸载 Canvas/终端订阅(完全体视口裁剪已出专项,见决策 #1)。
- **验收**:`memory.ws_cycle.heap_slope` ≈0 并升级为 warn 门禁;被驱逐 workspace 重新进入时状态正确恢复(测试)。

## WS-C 门禁与 CI 化

### C1 · GitHub Actions workflow 〔M,依赖 A6〕(决策 #3)
- **做法**:`.github/workflows/perf.yml`,ubuntu-latest:`apt-get install xvfb` → pnpm install → `setup:electron`(官方源失败自动走镜像)→ `perf:all`;上传 dashboard.html + report.json 为 CI artifact;**时间指标 CI 上只 record 不 gate**(机器不同),gate 仅体积 + 计数器。
- **验收**:PR 出现红绿检查;顺带补上根 CLAUDE.md §4 承认的 validation.yaml 无 runner 缺口(登记进 validation.yaml)。

### C2 · 时间指标 record→warn 升级 〔S,依赖 A3 攒同机历史 ≥5 次〕
- **验收**:baselines.json 出现时间类 warn 条目,按 program.md 铁律 2 执行。

### C3 · 看板趋势区 〔S-M〕
- **做法**:dashboard 读 `perf/history/` 同机序列画北极星趋势线(≥2 点)。
- **验收**:看板出现趋势区;修复类任务的收益在趋势上可见。

## 出专项(单独立项,不在本期)

- **视口裁剪完全体**(A1/H1 XL 改造)——决策 #1;
- chat mock 流回放 + F 维场景(先评审侵入面)、node-pty Electron ABI + 终端流式场景——原 M3 深水区,待本期收尾后评估。

## 决策记录(2026-07-04)

1. B7(拖拽 ephemeral)进专项;D3(视口裁剪)出专项单独立项。
2. I-1 debounce 默认 **200ms trailing + blur/保存 flush**;打字手感由产品验收,时长可调。
3. CI 采用 GitHub Actions(headless 配方已在无显示环境端到端验证)。
4. Sprint 切分:S1 = A1-A6 + B1/B3/B5;S2 = B2/B4/B6 + C1;S3 = B7/B8 + C2/C3。

## 交接材料索引

| 材料 | 位置 |
|---|---|
| 体系与指标字典(SSOT) | `perf/program.md`、`perf/metrics.json` |
| 发现明细(file:line + 修法) | `docs/performance-analysis-consolidated.md`、`-round3.md` |
| 操作手册 / Agent 操作流 | `perf/README.md`、`.pulse-coder/skills/perf-report/SKILL.md` |
| 阈值 | `perf/baselines.json`(修复必须同 PR 调整) |
| 无头环境启动 | `harness/README.md` Headless 小节、`setup:electron` |
