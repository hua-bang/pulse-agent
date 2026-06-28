# Canvas Workspace 性能评估基建设计

> 目的:为性能优化工作提供**可复现、带数字、防回归**的评估能力,使每个修复都能 before/after 对比,而非依赖静态推断。本文档是实现蓝图,定义四层基建的目录结构、脚本接口、指标与 CI 接入点。配套发现见 `docs/performance-analysis-consolidated.md`。

## 背景与动机

两轮性能分析共产出 67 条经对抗式验证的发现,但**全部为静态代码推断,零 profiling**。这带来两个问题:

1. **无法定序** —— 哪条是真瓶颈、收益多大,只能估算(报告中所有体积/耗时数字均标注为估算)。
2. **无法防回归** —— 已落地的修复(E1 getCwd 异步、D1 webview 延迟挂载)没有基线证明其有效,也无法阻止未来 PR 把 bundle 重新打回单 chunk、把 O(n) 退化成 O(n²)。

现状盘点(可复用的基础):
- `harness/`:已能用受控 profile 启动**真实 Electron 应用**,内置 CDP 集成(`harness/src/cdp.mjs`)、截图、导航、session 管理(`harness/src/{launch,profiles,commands,navigation,session}.mjs`)。这是 L3/L4 的现成载体。
- `vitest ^1.0.0` + `"test": "vitest run"`:vitest 1.x 自带 `bench` API,L2 可直接接入。
- `electron.vite.config.ts` renderer build(L111-116):目前无 `manualChunks`、无分析插件,是 L1 的接入点。

## 设计原则

1. **零生产成本** —— 所有 instrumentation 由环境变量(`PULSE_PERF=1`)gate,生产构建路径上无额外开销。
2. **确定性优先** —— 优先建设无需 Electron、可在 CI 稳定复现的层(L1/L2),把不确定的真机 profiling(L3/L4)作为补充。
3. **预算化防回归** —— 关键指标固化为 `perf-budgets.json`,CI 超阈值即失败,把"性能"变成可门禁的工程约束。
4. **复用 harness** —— 不在 Electron 主进程里塞测量代码;运行时测量通过既有 CDP 通道驱动真实应用。

---

## 四层总览

| 层 | 名称 | 验证发现 | CI 友好 | Electron 依赖 | 实现量 |
|---|---|---|---|---|---|
| **L1** | Bundle 体积预算 | C1–C9、D3/D4 | ✅ 确定性 | 需 build(非运行) | 小 |
| **L2** | 热函数微基准 | A3、B1、B2/B3、F1、G1/G4/G5 等算法类 | ✅ **无需 Electron** | 无 | 中 |
| **L3** | 启动 / time-to-window 打点 | D1/D2/D5/D6/D7、E1 | 半自动 | harness + CDP | 中 |
| **L4** | 运行时 profiling | A1/A2/A4、H1/H2、E2/E3、F2/F4、G2 | 手动/夜间 | harness + CDP tracing | 大 |

推荐实施顺序:**L2 → L1 → L3 → L4**(ROI 递减、不确定性递增)。

---

## L1 — Bundle 体积预算

**目标**:量化"哪些重依赖落进启动 chunk",并对启动 chunk 体积设预算门禁。直接度量 P1 的 `React.lazy`/`manualChunks` 拆分收益。

### 接入点与目录
```
apps/canvas-workspace/
  electron.vite.config.ts          # renderer.build 加 visualizer(env gate)
  scripts/perf/
    bundle.mjs                     # 构建 + 解析 stats + 表格 + 预算断言
  perf/
    budgets.json                   # 提交进仓的预算基线
    baselines/bundle.json          # 最近一次基线快照(供 diff)
```

### vite 配置改动(`electron.vite.config.ts` renderer 段)
```ts
// 仅在 PULSE_PERF_BUNDLE=1 时启用,生产构建零影响
renderer: {
  root: "src/renderer",
  build: {
    outDir: "dist/renderer",
    rollupOptions: process.env.PULSE_PERF_BUNDLE
      ? { plugins: [visualizer({ filename: "perf/out/bundle-treemap.html",
                                 template: "treemap", gzipSize: true,
                                 brotliSize: true, emitFile: false })] }
      : {},
  },
  plugins: [react(), localPluginRendererAssetsPlugin()],
}
```
> 备注:`rollup-plugin-visualizer` 同时产出 treemap(人看)与 `--json` stats(机读)。L1 不在此引入 `manualChunks`——那是 P1 的产品改动,L1 只负责**测量**。

### 脚本接口
```bash
pnpm --filter canvas-workspace perf:bundle            # 构建并打印当前体积表
pnpm --filter canvas-workspace perf:bundle --check     # 对 budgets.json 断言,超标 exit 1
pnpm --filter canvas-workspace perf:bundle --update     # 刷新 baselines/bundle.json
```
`scripts/perf/bundle.mjs` 行为:
1. `electron-vite build`(renderer)→ 读 `dist/renderer/assets/*.js`。
2. 解析每个 chunk 的 raw / gzip / brotli 字节;识别 entry chunk 与各 vendor 组(按模块路径归类:xterm / @tiptap / lowlight+highlight.js / react-force-graph+d3 / markdown-it / @module-federation / i18n-messages)。
3. 输出表格 + 写 `perf/out/bundle.json`。
4. `--check`:对 `budgets.json` 比对,任一超阈值则非零退出并打印 diff。

### 关键指标
- `entryChunkBytes`(raw / gzip):启动时主线程必 parse+eval 的 JS。
- `heavyDepInEntry[]`:xterm / tiptap / lowlight-common / force-graph / markdown-it / MF-runtime / messages.ts 是否仍在 entry chunk(布尔 + 字节)。
- `asyncChunkCount`:lazy 化后应 > 0(当前为接近 0)。

### budgets.json 示例
```json
{
  "entryChunkGzipBytes": { "max": 900000, "warn": 700000 },
  "heavyDepInEntry": {
    "xterm": false, "react-force-graph-2d": false,
    "lowlight-common": false, "@module-federation/runtime": false
  }
}
```
> 初值用首次 `--update` 的真实快照设定;P1 拆分落地后逐步收紧。

---

## L2 — 热函数微基准(最高 ROI)

**目标**:为报告中大量"O(n²)/O(n) 热函数"建立确定性 before/after 基线。**纯 TS,不加载 node-pty/Electron**,CI 可稳定跑。

### 目录
```
apps/canvas-workspace/
  vitest.bench.config.ts           # 独立 config:仅 include **/*.bench.ts,happy-dom/node 环境
  src/**/__bench__/*.bench.ts       # 与被测函数同域放置
```
`package.json` 加:`"bench": "vitest bench --config vitest.bench.config.ts"`。

### 优先基准对象(锚定真实发现)
| bench 文件 | 被测函数 | 发现 | 度量维度 |
|---|---|---|---|
| `AgentNodeBody/utils/__bench__/serializeBuffer.bench.ts` | `serializeBuffer`(全 buffer translateToString+join) | B1 | 1000/5000 行 scrollback 序列化耗时 |
| `utils/__bench__/frameHierarchy.bench.ts` | `computeParentContainerMap` / `collectContainerDescendants` | A3 | N=100/500/2000 节点、容器密度 |
| `main/canvas/__bench__/mergeExternalNodes.bench.ts` | `mergeExternalNodes` + per-node diff | B2/B3 | N 节点单点改动的合并成本 |
| `WorkspaceNodes/__bench__/buildGraphData.bench.ts` | `buildGraphData` + 邻居表 | G1 | N 节点/链、tag 扇出 |
| `WorkspaceNodes/__bench__/tagSearch.bench.ts` | `searchSuggestions` + `tagName` 线性扫 | G5 | N 节点 × M tag 每按键成本 |
| `utils/__bench__/mindmapLayout.bench.ts` | `mindmapLayout`(603 行) | — | 大 mindmap 布局 |
| `chat/utils/__bench__/markdown.bench.ts` | `renderMarkdown` + `highlightAuto` 路径 | F1 | 含代码块消息每 token 重解析 |

### 模式
```ts
import { bench, describe } from 'vitest';
import { computeParentContainerMap } from '../frameHierarchy';
for (const n of [100, 500, 2000]) {
  describe(`computeParentContainerMap n=${n}`, () => {
    const nodes = makeNodes(n, { containerRatio: 0.2 });   // 确定性 fixture,无随机
    bench('current', () => { computeParentContainerMap(nodes); });
  });
}
```
- **fixture 确定性**:节点生成用固定参数(无 `Math.random`),保证跨运行可比。
- **相对优先**:微基准的绝对 ms 受机器影响,价值在**同机 before/after 比值**与**随 N 的增长曲线**(暴露 O(n²))。
- **CI 用法**:PR 跑 bench,把关键比值写进 job summary;不做硬门禁(机器噪声),但对"增长阶数"做断言(如 n 翻 4 倍耗时不应超 ~6 倍)。

### 共享 fixture
```
src/__perf_fixtures__/nodes.ts      # makeNodes(n, opts):生成 canvas 节点数组
src/__perf_fixtures__/graph.ts      # makeWorkspaceGraph(n, links, tags)
src/__perf_fixtures__/scrollback.ts # makeXtermBuffer(lines) 的轻量 stub
```

---

## L3 — 启动 / time-to-window 打点

**目标**:量化冷启动关键路径各段耗时与 time-to-first-window。直接回测已落地的 **E1 / D1** 与待做的 **D2 bootstrap 重排**。

### Instrumentation(`PULSE_PERF=1` gate)
主进程 `src/main/app/bootstrap.ts`:
```ts
const mark = (name: string) => { if (process.env.PULSE_PERF) perfMarks.push({ name, t: performance.now() }); };
// app.whenReady 起点 → 各 await 段(seeding/env/builtin-plugins/external-plugins)→ openWindow → did-finish-load
```
渲染进程 `src/renderer/src/main.tsx`:`performance.mark('renderer:firstRender')` 包住 `createRoot().render()`。
落点统一经一个 `PULSE_PERF` gated 的 IPC(`perf:marks`)汇总;harness 经 CDP 读取。

### harness 命令(扩 `harness/src/commands.mjs`)
```bash
pnpm --filter canvas-workspace harness perf-startup --runs 7 --profile temp
```
行为:以 `PULSE_PERF=1` 启动 N 次(每次 fresh `temp` profile 保证冷启),经 CDP/IPC 收集 marks,输出各段中位数 + p95,写 `perf/out/startup.json`。

### 关键指标
- `appReady→openWindow`:被 seeding + 工具 env + 内建/外部插件 await 占用的时长(D2/D5/D6/D7)。
- `openWindow→did-finish-load`:renderer 下载/解析/首绘(C/D bundle 相关)。
- `firstRender` 时刻;`welcomeWebview did-finish-load`:是否计入 TTFMP(**D1 回测点**——延迟挂载后此项应移出关键路径)。
- 分组:有/无外部插件两组对照。

### 与已落地修复的闭环
- **E1**:对一个含 N 个终端节点的 demo 工作区,测稳态下主进程 IPC 往返 p95(getCwd 异步前后)。
- **D1**:对比 welcome 工作区 TTFMP —— webview 延迟挂载前后,`did-finish-load` 是否还卡在首帧。

---

## L4 — 运行时 profiling

**目标**:度量稳态 CPU/内存/帧率与交互卡顿。最重、最不确定,作为夜间/按需任务,不进 PR 门禁。

### 压力 fixture(扩 harness profiles)
`harness/src/profiles.mjs` 加 `stress` profile:seed 含可配置 N 的工作区(N 终端 / N 文件 / N iframe / N 节点的大画布;含 keep-alive 多 workspace 场景)。
```bash
pnpm --filter canvas-workspace harness start --profile stress --nodes 200 --terminals 20
```

### 脚本化交互 + CDP tracing(扩 `harness/src/cdp.mjs`)
```bash
pnpm --filter canvas-workspace harness perf-runtime --scenario pan-zoom --profile stress
```
内置 scenario:
- `pan-zoom`:连续平移/缩放大画布 → 测 A1/A2/A4/E2(帧时长、long task、`measureText`/`fit` 调用数)。
- `terminal-stream`:向终端灌高吞吐输出 → 测 E3/E2(IPC 频次、帧时长)。
- `chat-stream`:流式一条含代码块/mermaid 的长回复 → 测 F1/F2/F4(每 token 重解析、mermaid 主线程 stall)。
- `graph-toggle`:切换 graph 可见性 toggle → 测 G2(12s reheat 主线程占用)。
- `idle-memory`:访问 K 个 workspace 后静置 → 测 H1/H2(堆增长、offscreen webview CPU)。

采集:CDP `Performance.getMetrics`、`Tracing`(帧 / long task / JS heap)、`app.getAppMetrics()`(guest 进程数 / RSS)。输出 `perf/out/runtime-<scenario>.json`。

### 关键指标
- 交互期 p95 帧时长、long task 计数与总时长。
- 稳态 JS heap 斜率(idle-memory:应平,当前 keep-alive 下单调增)。
- guest WebContents 进程数 / 总 RSS(验证 D1/H1/H2)。
- 场景级自定义计数(`measureText`/frame、`pty:resize` IPC/s 等),经 L3 同款 gated 计数器暴露。

---

## CI 接入

```
.github/workflows/perf.yml(新增)
  job: bench      → pnpm bench(L2),把关键比值写 job summary;增长阶数断言
  job: bundle     → PULSE_PERF_BUNDLE=1 pnpm perf:bundle --check(L1),超预算 fail
  (L3 startup / L4 runtime:夜间 schedule 或 workflow_dispatch,产物上传 artifact,不阻塞 PR)
```
门禁策略:**L1 bundle 预算 + L2 增长阶数**进 PR 必过;L3/L4 进夜间报告(趋势监控),避免真机噪声误杀 PR。

## 落地阶段

1. **Phase 1(L2)**:`vitest.bench.config.ts` + 共享 fixture + 前 4 个 bench(serializeBuffer / frameHierarchy / mergeExternalNodes / buildGraphData)。无 Electron 依赖,最快见效。
2. **Phase 2(L1)**:visualizer 接入 + `bundle.mjs` + 首次 `--update` 设基线 + budgets.json。
3. **Phase 3(L3)**:bootstrap/main.tsx 打点 + `harness perf-startup`;回测 E1/D1。
4. **Phase 4(L4)**:stress profile + scenario 脚本 + CDP tracing;夜间任务。
5. **CI**:Phase 1/2 完成后接 `perf.yml` 的 bench/bundle 门禁。

## 非目标

- 不追求绝对耗时的跨机一致(微基准只保同机相对可比)。
- 不在主进程/渲染端生产路径留任何常驻测量开销(全 `PULSE_PERF*` gate)。
- L4 不进 PR 硬门禁(真机噪声),仅作趋势监控。

## 与发现的映射(回测覆盖)

| 基建层 | 可量化/回测的发现 |
|---|---|
| L1 | C1–C9、D3、D4 |
| L2 | A3、B1、B2、B3、F1、G1、G4、G5(+ mindmapLayout) |
| L3 | D1、D2、D5、D6、D7、E1 |
| L4 | A1、A2、A4、E2、E3、F2、F4、G2、H1、H2 |

> 覆盖后,`performance-analysis-consolidated.md` 中的"估算"列可逐步替换为实测值,并据此重排 P0/P1/P2 优先级。
