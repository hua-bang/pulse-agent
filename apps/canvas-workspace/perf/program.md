# Canvas Workspace 性能体系(SSOT)

> 本文是性能专项的规划与指标口径的单一事实源。
> 分工:`README.md` 管操作(怎么跑),`baselines.json` 管阈值(数字),本文管**体系**(专项划分、指标定义、采集规范、路线图)。
> 发现清单见 `../docs/performance-analysis-consolidated.md`(67 条)+ `../docs/performance-analysis-round3.md`(20 条)。
> 体积专项的当前审计、分阶段任务卡和交接协议见 `bundle-optimization-plan.md`；
> 其中数字是规划证据，落地后的正式阈值仍只写入 `baselines.json`。

## 1. 六专项

每个专项回答一组用户可感知的问题;87 条发现全部归位,无剩余、无空格:

| # | 专项 | 回答的问题 | 关联发现 | 北极星指标 |
|---|---|---|---|---|
| ① | 启动 | 点开到画布可交互要多久?最慢一段在哪? | D 维(8) | `startup.dom_ready_ms` |
| ② | 交互 | 打字/调整尺寸/拖拽/平移卡不卡?多大画布开始卡? | A/I/G 维(24) | 离散交互 INP + cold presented-frame 代理 + Pan/Zoom 帧指标 |
| ③ | 体积 | 启动 parse 多少 JS?懒边界会不会被破坏? | C 维(9) | `bundle.entry_raw_kb` |
| ④ | 内存驻留 | 切 N 个 workspace 后内存回落吗? | H/L 维+K-1(11) | `memory.ws_cycle.post_capacity_heap_slope` |
| ⑤ | 主进程健康 | IPC 最多被卡多久、被谁卡? | B/E/J 维(24) | `main.loop_delay_p99_ms` |
| ⑥ | AI 流式 | 代码密集回复流式时掉帧吗? | F 维+K-2~4(11) | `chat.stream.frames_over20_pct` |

## 2. 指标字典

字段说明——**聚合**:时间类取 N≥3 轮中位数;计数类恰等(确定性);斜率类线性回归。**可比性**:`全局` = 机器无关可跨环境比;`同机` = 只与同一台机器、同一 measurement profile 的历史比。**方向**:`lower` / `higher` / `exact` / `true`。**等级**:`gate`(Gate 失败 exit 1)/ `warn`(目标告警不阻断)/ `record`(仅记录)。**覆盖类**:`core`(默认,完整报告必须采齐)/ `diagnostic`(可选诊断,缺失不打红核心报告)。**展示优先级**:`primary`(P0 关键结果)/ `supporting`(P1 分项观测)/ `diagnostic`(P2 排障证据);它只控制看板层级,不改变等级或覆盖类。**维度**:`dimension` 必须引用所属专项在 `dimensions[]` 中声明的语义分组。**采集状态**:✅ 已采 / ◐ 已埋待采 / ○ 未建。

目标、预警和 Gate 的数字只存在 `baselines.json → policies`;`metrics.json` 只保存稳定语义。**目标**回答“产品是否足够好”,**warning**回答“偏离是否已明显”,**Gate**回答“是否出现必须阻断的回归”,三者独立。目标状态为 `met / near-warning / missed / pending / not-applicable`;Gate 为 `pass / fail / unavailable / not-applicable`。例如入口体积可以“目标未达”但仍“ratchet Gate PASS”。同机目标只在 `profiles[].appliesTo` 完全匹配时判定,不同 machineId/OS/架构/节点数/网页节点数/真实 URL WebView 节点数/repeat/fixture/session profile/headless 模式不交叉比较。

具体目标、warning、置信度与依据由看板从 `baselines.json` 动态展示;本文不复制数值。warm renderer trace 的目标仍是 Electron `file://` warm-reload lab 预算,不是 CrUX/field Core Web Vitals。

看板默认直接展示每个专项的 1–4 个 P0 指标;P1/P2 按维度折叠。专题红黄绿只由 P0 目标决定,Gate 单独展示并仍产生 HIGH 告警。目标未达、接近预警、Gate 失败或被告警精确引用的指标所在维度会自动展开,所以展示降噪不会隐藏回归。`report.json` 同时输出 `policyVersion`、`targetSummary`、`gateSummary`、`policyEvaluations` 和带逐项 policy 的实测 metrics。

### ① 启动(采集:`[perf] startup` 日志行 + `__pulsePerf` marks + warm renderer CDP trace)

| 指标 ID | 定义(口径) | 单位 | 可比性 | 等级 | 状态 |
|---|---|---|---|---|---|
| `startup.when_ready_ms` | 进程启动 → app.whenReady | ms | 同机 | warn | ✅ 3 次独立 boot 中位数 |
| `startup.serial_chain_ms` | whenReady → pluginsActivated(D2 观测) | ms | 同机 | warn | ✅ 3 次独立 boot 中位数 |
| `startup.open_window_ms` | 进程启动 → openWindow | ms | 同机 | warn | ✅ 3 次独立 boot 中位数 |
| `startup.dom_ready_ms` | 进程启动 → 首窗 dom-ready(北极星) | ms | 同机 | warn | ✅ 3 次独立 boot 中位数 |
| `startup.renderer.fcp_ms` | renderer navigation → first-contentful-paint | ms | 同机 | record | ✅ |
| `startup.renderer.first_canvas_ms` | renderer navigation → CanvasSurface 首次渲染 | ms | 同机 | warn | ✅ |
| `startup.renderer.entry_eval_ms` | navigation → `renderer:main-start` mark;包含导航前段,**不是纯 V8 compile/eval** | ms | 同机 | record | ✅ |
| `startup.welcome_local_content_ms` | Renderer 导航 → Welcome 本地下载卡片 ready(D1) | ms | 同机 | warn | ✅ |
| `startup.renderer_reload.lcp_ms` / `.cls` | warm renderer reload 的 lab LCP/CLS;Electron `file://`,不是 CrUX/field CWV | ms/score | 同机同 profile | record·diagnostic | ✅ CDP |
| `startup.renderer_reload.layout_shift_count` | 无近期输入的 layout-shift entry 数;top 5 shift 同存 summary | 次 | 同机同 profile | record·diagnostic | ✅ CDP |
| `startup.renderer_reload.blocking_time_to_canvas_ms` | warm reload 的 FCP→Canvas 壳层 mark 阻塞交集;不是完整加载 TBT | ms | 同机同 profile | record·diagnostic | ✅ CDP |
| `startup.renderer_reload.blocking_canvas_to_lcp_ms` | Canvas 壳层 mark→LCP 的 Long Task 阻塞交集,补足后段可见成本 | ms | 同机同 profile | record·diagnostic | ✅ CDP |
| `startup.renderer_reload.long_task_count` / `.long_task_max_ms` | 整个 trace 窗口 Long Task 数与最大持续时间 | 次/ms | 同机同 profile | record·diagnostic | ✅ CDP |
| `startup.loaded_to_canvas_kb` / `startup.loaded_to_lcp_kb` | warm reload 中 CDP Network 按 responseEnd 截止到 Canvas/LCP 的本地资源字节 | KB | 同机同 profile | **gate**·diagnostic | ✅ Phase 4 升 Gate |
| `startup.renderer_reload.{task,script,recalc_style,layout}_ms` | warm reload 前后 CDP Performance counters 差值 | ms | 同机同 profile | record·diagnostic | ✅ CDP |

精确 `M=0` 会在 N 节点 reload 前把 welcome 网页规范化为 text。为保持该 core 指标可采,
runner 仅在 reload 缺少 `welcome:local-content-ready` 时回填 seeding 前的初始 mark,并写
`welcomeLocalContentSource: initial-pre-seed`;其余 startup renderer marks 仍全部来自 N 节点
reload。若 reload 自身仍产出该 mark,来源记录为 `seeded-reload`。

### ② 交互(采集:`perf:scenarios` 经 CDP 驱动 + `__pulsePerf`;场景:`typing`✅ `resize`✅ `drag`✅ `zoom-cold`✅ `panzoom`✅ `zoom-settle`✅ `mindmap_drag`○)

| 指标 ID | 定义(口径) | 单位 | 可比性 | 等级 | 状态 |
|---|---|---|---|---|---|
| `interact.<s>.inp_p95_ms` | 场景窗口内 Event Timing(含 interactionId)duration p95 | ms | 同机 | warn→gate | ✅ typing 16 / resize 32(record) / drag 32 @100节点(2026-07-10) |
| `interact.<s>.frames_over20_pct` | 动作窗口内 rAF 帧间隔 >20ms 占比的 N 轮中位数;保存 drain 不进分母 | % | 同机 | warn | ✅ |
| `interact.<s>.frames_over20_pct_max` | 同批 repeat 中单轮最差的 >20ms 帧占比;detail 带慢帧数 | % | 同机 | record | ✅ |
| `interact.zoom_cold.first_wheel_to_next_frame_ms` | 画布无 moving/动画标记后,每轮仅一次 Ctrl+Wheel 的 capture handler→下一 rAF;保留用于旧报告/历史兼容,该 rAF 可能早于应用 transform rAF | ms | 同机 | record·diagnostic | ✅ legacy;不作为可见帧证据 |
| `interact.zoom_cold.first_wheel_to_presented_frame_ms` | 同一 wheel 起点;事件传播后排队观察 rAF,必须先读到 computed transform 改变,再跨 1 个 rAF 呈现边界 | ms | 同机 | record·primary | ✅ 首帧主证据;呈现帧代理,非 GPU swap 时间;有兼容历史前不设基线 |
| `interact.panzoom.wheel_to_next_frame_p95_ms` | capture handler→下一 rAF 的调度 p95;该 rAF 可能早于 React handler 的 transform 写入,只为历史兼容保留 | ms | 同机 | record·diagnostic | ✅ scheduling diagnostic;无 target/warning/Gate |
| `interact.zoom_settle.last_wheel_to_rest_ms` | 最后一次 Ctrl+Wheel → moving flag 清除 + 160ms transition allowance + 2×rAF;包含产品的 180ms idle debounce | ms | 同机 | record·diagnostic | ✅ 默认发布 workload |
| `interact.zoom_settle.frames_over20_pct` / `_max` | 从缩放手势开始到完全稳定的 >20ms 帧占比中位数 / 单轮最差值 | % | 同机 | record·diagnostic | ✅ 默认发布 workload |
| `interact.<s>.loaf_blocking_ms` | 长动画帧 blockingDuration 合计 | ms | 同机 | record | ✅ |
| `interact.<s>.counter.nodes_array_replace` | 场景内整 nodes 数组替换次数(A2/I-1 守卫) | 次 | **全局** | **gate** | ✅ typing 2 / resize 1 / drag 1,均≤10(2026-07-10) |
| `interact.<s>.counter.canvas_save_ipc` | 场景内 canvas:save 发起次数 | 次 | **全局** | **gate** | ✅ typing 2 / resize 2 / drag 1,均≤3(2026-07-10) |
| `interact.<s>.counter.terminal_fit` | 场景内 xterm refit 次数(E2/E9 守卫) | 次 | **全局** | gate | ◐ 已埋,待含终端场景 |
| `interact.scale.inp_ratio_100_3` | 同场景 100 节点 / 3 节点 INP p95 之比(规模退化系数) | 倍 | 全局(近似) | warn | ○ 由 repeat 派生 |

`resize` 的 Event Timing 只覆盖离散 pointerdown/up,不覆盖连续 pointer-move;因此 `interact.resize.inp_p95_ms` 为 record 级,连续手感以帧指标为准。wheel 不属于 Event Timing 离散交互集合,所以不再产出会误导为 `0ms` 的 Pan/Zoom INP。`zoom-cold` 的 cold 指“静止手势的第一下”,不是 Electron 冷启动;它在旧 `panzoom` 之前独立执行。cold presented-frame 是首帧主证据:探针确认 transform 写入后再等待一个 rAF,用于跨过后续渲染机会,但不等价于 compositor/GPU 实际上屏时间。Pan/Zoom 的旧 capture→rAF 值只描述调度且保持 record-only;持续手感只看 `frames_over20_pct` 与 `frames_over20_pct_max`。`zoom-settle` 另行覆盖最后 wheel 到 moving debounce、scale transition 和双 rAF 结束的完整尾段,因此作为默认 record-only 诊断而不与短 active window 混用。其余交互帧统计在动作结束后的双 rAF 冻结,计数器仍继续到保存 drain 完成。

### ③ 体积(采集:`perf:bundle`,构建产物静态度量;全部机器无关)

| 指标 ID | 定义(口径) | 单位 | 可比性 | 等级 | 状态 |
|---|---|---|---|---|---|
| `bundle.entry_raw_kb` | Vite manifest `isEntry` 对应 JS 原始字节(产品目标见 baselines policy) | KB | 全局 | **gate** | ✅ |
| `bundle.entry_gzip_kb` | 同上 gzip -9 | KB | 全局 | **gate** | ✅ 224(minify 后) |
| `bundle.startup_js_raw_kb` / `startup_js_gzip_kb` | manifest 入口递归静态 `imports` 的去重 JS 闭包 | KB | 全局 | record | ✅ 已建，稳定两轮后升 Gate |
| `bundle.startup_css_raw_kb` / `startup_css_gzip_kb` | 上述静态闭包关联 CSS 的去重总量 | KB | 全局 | **raw gate** / gzip record | ✅ raw 已于 Phase 2 升 Gate |
| `bundle.startup_request_count` | 启动静态 JS + CSS 闭包文件数 | 个 | 全局 | record | ✅ 已建 |
| `bundle.total_js_kb` | `dist/renderer` 内全部 JS 原始字节先求和、最后换算 KB | KB | 全局 | **gate** | ✅ |
| `bundle.total_css_raw_kb` | `dist/renderer` 内全部 CSS 原始字节先求和、最后换算 KB | KB | 全局 | record | ✅ 已建 |
| `bundle.main_raw_kb` / `bundle.preload_raw_kb` | Main / Preload 入口构建输出原始字节 | KB | 全局 | **Main gate** / Preload record | ✅ Main 于 Phase 4 升 Gate |
| `bundle.feature_first_load.<feature>_raw_kb` | File/Chat/Terminal/Graph/Mermaid/MF 的 manifest 静态闭包扣除启动已加载文件后的 JS+CSS 增量 | KB | 全局 | record | ✅ 已建 |
| `package.dmg_mb` / `package.app_unpacked_mib` | `perf:package` 采集的 macOS arm64 DMG 与解压 `.app` | MB/MiB | 同平台架构 | **gate** | ✅ 96.6 / 235.1 |
| `package.asar_mib` / `package.native_unpacked_mib` | app.asar 与 native unpacked 载荷 | MiB | 同平台架构 | **gate** | ✅ 44.0 / 2.3 |
| `package.electron_locale_count` | Electron Framework 保留的 `.lproj` 数量 | 个 | 同平台架构 | **gate** | ✅ 3 |
| `bundle.chunk_count` | JS chunk 数 | 个 | 全局 | record | ✅ 77 |
| `bundle.lazy_boundary_watchlist` | Rollup entry module IDs 中 WATCHLIST 包保持缺席 | bool | 全局 | **gate** | ✅ 6/6 保持 lazy |
| `bundle.heavy_in_entry_count` | 入口模块图的重依赖命中数(xterm/tiptap/hljs/d3/MF/mermaid) | 个 | 全局 | record | ✅ 0/6 在 entry |
| entry 内依赖归因 | Rollup 每依赖渲染字节(A5,`entryDepStatsPlugin` opt-in via `PULSE_CANVAS_PERF_ANALYZE=1`);非固定 ID 的标量指标,不进 metrics.json/history 棘轮体系——结构化数据在 `bundle-report.json` 的 `entryDepAttribution` 字段,体积 Tab(D2)直接读取渲染 | KB | 全局 | record(展示,不进 rule engine) | ✅ 已建 |

### ④ 内存驻留(采集:`__pulsePerf` JS 堆 + `app.getAppMetrics()`;核心是斜率不是单点)

| 指标 ID | 定义(口径) | 单位 | 可比性 | 等级 | 状态 |
|---|---|---|---|---|---|
| `memory.ws_cycle.post_capacity_heap_slope` | 依次切 ≥8 个等节点 workspace,LRU 达容量后尾部 retained heap 线性回归斜率(北极星) | MB/ws | 同机 | warn | ✅ |
| `memory.ws_cycle.nodes_per_workspace` | 等负载驻留场景每个 workspace 的节点数 | 节点 | 全局 | record | ✅ |
| `memory.ws_cycle.post_capacity_sample_count` | 达到 active+3 容量后的尾部堆样本数 | 个 | 全局 | record | ✅ |
| `memory.ws_cycle.peak_mounted_workspace_count` | 切换过程中同时挂载的 workspace 峰值,验证 active+3 LRU 上限 | 个 | 全局 | record | ✅ |
| `memory.ws_cycle.rss_slope` | 同场景全进程 RSS 合计斜率 | MB/轮 | 同机 | warn | ○ |
| `memory.baseline.total_rss_mb` | 欢迎画布稳态全进程 RSS(含 Xvfb) | MB | 同机 | record | ✅ 568 |
| `memory.n100.total_rss_mb` | 100 节点画布稳态 | MB | 同机 | record | ✅ 726 |
| `memory.image.decoded_mb` | 10×4K 图普通画布 preview 解码像素估算(K-1 守卫) | MB | 全局(固定尺寸) | record | ✅ 26.4MB(vs 原图 457.8MB) |
| `memory.webview_guest_count` | Chrome-style 回收后 CDP `type=webview` target 数(H2 守卫) | 个 | 全局 | record | ✅ cap 16 |
| `memory.webview.total_rss_released_mb` | 同一进程会话执行深度休眠前后全进程 RSS 差值 | MB | 同机 | record | ✅ |
| `memory.webview.after_discard_rss_mb` | 深度休眠收敛后全进程绝对 RSS，防止“更肥的 before”虚增 released | MB | 同机 | record | ✅ |
| `memory.webview.restore_ready_ms` | 唤醒已回收节点至新 WebContents 新 document 可执行的时长 | ms | 同机 | record | ✅ |
| `memory.soak30.heap_growth_mb` | 30min 空闲+周期操作后堆净增长 | MB | 同机 | warn | ○ M2 nightly |

### ⑤ 主进程健康(采集:main 侧 `PULSE_CANVAS_PERF=1` 采样器 + I/O/IPC 计数器)

| 指标 ID | 定义(口径) | 单位 | 可比性 | 等级 | 状态 |
|---|---|---|---|---|---|
| `main.loop_delay_p99_ms` | 场景窗口内 monitorEventLoopDelay p99(北极星;E/J 维总汇) | ms | 同机 | warn | ✅ |
| `main.loop_delay_max_ms` | 同窗口最大值(单次冻结上限) | ms | 同机 | warn | ✅ |
| `main.canvas_save.write_bytes` | 单次 canvas:save 实际落盘字节(B3 修复标尺) | KB | 全局 | gate | ○ M1 |
| `main.canvas_save.files_written` | 单次 save 写文件数(未变更应跳过) | 个 | **全局** | warn | ✅ |
| `main.session_persist.bytes_per_turn` | 每 agent turn 会话持久化字节(J-1 标尺,修复后应 O(增量)) | KB | 全局 | **gate** | ✅ mock turn 走真实 SessionStore |
| `main.pty.ipc_per_sec` | 双终端流式时 pty:data IPC 条数/秒(E3 合并 flush 标尺) | 条/s | 全局 | record | ✅ 双真实 PTY 场景 |

### ⑥ AI 流式(采集:mock 回放场景〔M3,需先评审侵入面〕+ 已埋计数器;fixture:3 代码块 + 1 mermaid 定速回放)

| 指标 ID | 定义(口径) | 单位 | 可比性 | 等级 | 状态 |
|---|---|---|---|---|---|
| `chat.stream.frames_over20_pct` | 回放期帧超率(北极星) | % | 同机 | warn | ✅ |
| `chat.stream.md_render_count` | 回放期流式 Markdown 全量渲染次数 | count | **全局** | **gate** | ✅ |
| `chat.stream.commit_count` | 521 delta 回放期间流式 UI commit 次数 | count | **全局** | **gate** | ✅ |
| `chat.stream.md_cache_hit_ratio` | 强制一次真实 settled 内容重渲后 cache-hit / opportunity | % | **全局** | **gate** | ✅ |
| `chat.stream.md_cache_hit_count` / `.md_cache_opportunity_count` | 缓存命中次数与 settled 渲染机会数;机会为 0 时不得伪造 ratio=0 | 次 | 全局 | record | ✅ |
| `chat.stream.tail_burst_ms` | 流结束 → 全部 mermaid 渲染完(F4/F5 守卫) | ms | 同机 | warn | ✅ |
| `chat.mermaid.render_ms` | 单图 mermaid.render 耗时 | ms | 同机 | record | ○ |

## 3. 采集与记录规范

**命名**:`<专项>.<场景>.<指标>`,计数器加 `counter.` 段;场景无关的省场景段。

**覆盖**:`coverage.measured/total` 只统计 `core` 定义中已产出 finite number/boolean 的唯一已知 ID;unknown/duplicate/null/NaN 均不计。`coverage.diagnostic` 单列 CDP trace 等可选证据层。无样本、不适用、CDP/heap 读取失败或 trace `dataLossOccurred` 必须表现为 unavailable/缺失并让相应 coverage 暴露,绝不能伪造为 0。

**记录 schema**(每次运行 append 一份到 `perf/history/<yyyy-mm-dd>-<commit>.json`):

```json
{
  "commit": "be8defb", "timestamp": "…", "machineId": "<hostname-hash>",
  "env": { "os": "darwin", "arch": "arm64", "cores": 10, "seedNodes": 100, "seedWebpages": 0, "seedUrlWebviews": 0, "repeat": 3, "fixtureVersion": "perf-v2", "sessionProfile": "temp", "headless": false },
  "metrics": [
    { "id": "interact.typing.counter.nodes_array_replace", "value": 120, "runs": 1 },
    { "id": "interact.typing.inp_p95_ms", "value": 48, "runs": 3, "raw": [46, 48, 51] }
  ]
}
```

场景 fixture 的组成证据写入 `scenarios-report.json.fixture`: `requested`
与 `observed` 分别记录节点/网页/URL WebView 数量;真实 URL WebView 运行还必须逐项记录
`id`、loopback `url`、`isLoading:false`、guest readiness marker、真实 Electron
`webContentsId` 与每次 document 实例唯一的 `instanceToken`;交互后仅当 URL/marker/
WebContents/document token 均未变化才记录 `statePreserved:true`。历史兼容键包含
`seedUrlWebviews`;旧快照缺失该键按 `0` 解释,但任何 `>0` 的真实 WebView 运行不会与旧的
纯 HTML iframe 历史交叉比较。

运行时 fixture 从本版起为 `perf-v2`:temp profile 的真实 welcome 基底
`3 nodes / 1 HTML webpage / 0 URL WebView` 会被精确规范化到 N/M/U;只允许改写
`node-welcome-download` 与 `perf-seed-*`,未知用户节点超额时 fail closed。URL WebView
seeding 仅允许 `profile=temp`,并要求结束后 `close --cleanup`。`perf-v1` 旧基线的含义与
数字不改,且因 fixtureVersion 不同不会与 `perf-v2` 历史交叉比较。

自动 `--seed-nodes 86 --seed-webpages 40 --seed-url-webviews 25` 只是一份
WebView 隔离回归夹具:除 welcome/网页节点外,其余容量由 text 填充,不包含用户脱敏负载中的
19 Frame、文件、图片、思维导图与 running Agent。它的 cold presented 与 capture 调度结果
保持 record-only;帧指标因没有 86/40/25 measurement profile 而对现有 100/0/0 policy 显示
`not-applicable`;完整用户画布结论
必须另有混合类型诊断证据。

显式诊断场景 `--scenario webview-lifecycle` 不进入默认 workload。它在同一个确定性
loopback guest 上依次采固定 1 秒的“原生几何离屏”窗口与“临时迁入 viewport”窗口，
记录初始 total/offscreen/intersecting guest 数及 guest rAF/10ms interval delta。该差值只
标记为 native geometric lifecycle phase contrast。受控同几何 A/B 中，额外添加
`visibility:hidden` 没有恢复或进一步降低 rAF/timer，也没有稳定 trace 收益，因此生产版
撤回了每 guest Observer/CSS class 实验，不把组合差值归因为 CSS incremental benefit。
场景必须恢复目标原始 translate/z-index，证明目标重新离屏、WebContents id/document
instance/readiness marker/注入的 DOM state 全部不变，并清理 guest 内 rAF 与 timer；无
offscreen 样本、guest 执行不支持、visible 样本不足、缺少生命周期差异、几何恢复或清理
失败均 fail closed，不以 0 伪装为实测。

显式诊断场景 `--scenario webview-discard-restore` 验证生产版 Chrome-style 深度休眠协议。
它要求至少 17 个真实 loopback guest，强制协调器收敛到 16 个 live guest 上限，同时分别
核对 DOM `<webview>` 数与 CDP `type=webview` target 数；随后唤醒一个已回收节点，要求
WebContents id 与 document instance 均换代、runtime URL 与 scrollY 恢复，并记录 RSS
回落与 restore-ready 时长。该场景会主动改变 guest 身份，因此不进入一般交互的
`statePreserved` 断言，也不进入默认 workload。

**三条铁律**:
1. 时间类指标按 `machineId + measurementProfile` 比较,profile 不一致时明确显示“不适用”;确定性计数器使用全局 profile。
2. `level:gate` 必须在 policy 中有可执行 Gate,否则配置校验直接失败;时间类升级 Gate 前仍要求同机同 profile ≥5 次历史且方差 < 容差的一半。
3. **修复联动**:修一个发现,同 PR 下调产品 target 或回归 Gate(如修 I-1 后 `nodes_array_replace` max 132→20),数字只改 `baselines.json`。

## 4. 路线图

- **M1(填空格)**:④ 切换循环+堆斜率 ✅ → ⑤ loop-delay+写字节 ✅ → ② repeat+panzoom ✅ → ③ treemap ✅ → `perf:all` 一键全跑 ✅(即 `perf:report`)。M1 已全部填完。
- **M2(门禁化)**:history/趋势上看板 → 时间指标按铁律 2 升级 → CI workflow(补 `harness/validate/validation.yaml` runner 缺口)→ soak 进 nightly。
- **M3(修复联动)**:修 I-1/J-1/J-2/K-1/H1 并下调基线 → chat 回放入口(评审后)→ 终端流式(解 node-pty Electron ABI)。

**完成态判据**:六专项北极星指标全部 ≥warn 级、计数器全部 gate 级、CI 每 PR 跑体积+计数器、nightly 跑全量、看板趋势区有数据。
