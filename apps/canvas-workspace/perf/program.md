# Canvas Workspace 性能体系(SSOT)

> 本文是性能专项的规划与指标口径的单一事实源。
> 分工:`README.md` 管操作(怎么跑),`baselines.json` 管阈值(数字),本文管**体系**(专项划分、指标定义、采集规范、路线图)。
> 发现清单见 `../docs/performance-analysis-consolidated.md`(67 条)+ `../docs/performance-analysis-round3.md`(20 条)。

## 1. 六专项

每个专项回答一组用户可感知的问题;87 条发现全部归位,无剩余、无空格:

| # | 专项 | 回答的问题 | 关联发现 | 北极星指标 |
|---|---|---|---|---|
| ① | 启动 | 点开到画布可交互要多久?最慢一段在哪? | D 维(8) | `startup.cold.dom_ready_ms` |
| ② | 交互 | 打字/拖拽/平移卡不卡?多大画布开始卡? | A/I/G 维(24) | `interact.*.inp_p95_ms` + 计数器 |
| ③ | 体积 | 启动 parse 多少 JS?懒边界会不会被破坏? | C 维(9) | `bundle.entry_raw_kb` |
| ④ | 内存驻留 | 切 N 个 workspace 后内存回落吗? | H/L 维+K-1(11) | `memory.ws_cycle.heap_slope` |
| ⑤ | 主进程健康 | IPC 最多被卡多久、被谁卡? | B/E/J 维(24) | `main.loop_delay_p99_ms` |
| ⑥ | AI 流式 | 代码密集回复流式时掉帧吗? | F 维+K-2~4(11) | `chat.stream.frames_over20_pct` |

## 2. 指标字典

字段说明——**聚合**:时间类取 N≥3 轮中位数;计数类恰等(确定性);斜率类线性回归。**可比性**:`全局` = 机器无关可跨环境比;`同机` = 只与同一台机器的历史比。**等级**:`gate`(超阈值 exit 1)/ `warn`(告警不阻断)/ `record`(仅记录)。**状态**:✅ 已采 / ◐ 已埋待采 / ○ 未建。

### ① 启动(采集:`[perf] startup` 日志行 + `__pulsePerf` marks;冷=会话首次启动,热=同会话再次启动,分开统计)

| 指标 ID | 定义(口径) | 单位 | 可比性 | 等级 | 状态 |
|---|---|---|---|---|---|
| `startup.{cold,warm}.when_ready_ms` | 进程启动 → app.whenReady | ms | 同机 | warn→gate | ✅ n=1(冷1598/热902) |
| `startup.{cold,warm}.serial_chain_ms` | whenReady → pluginsActivated(D2 守卫) | ms | 同机 | gate | ✅ n=1(34) |
| `startup.{cold,warm}.open_window_ms` | 进程启动 → openWindow | ms | 同机 | warn | ✅ n=1 |
| `startup.{cold,warm}.dom_ready_ms` | 进程启动 → 首窗 dom-ready(北极星) | ms | 同机 | warn→gate | ✅ n=1(冷2358) |
| `startup.renderer.fcp_ms` | renderer 起点 → first-contentful-paint | ms | 同机 | record | ◐ observer 已埋 |
| `startup.renderer.first_canvas_ms` | renderer 起点 → CanvasSurface 首次渲染 | ms | 同机 | record | ◐ mark 已埋 |
| `startup.renderer.entry_eval_ms` | entry chunk V8 compile+eval(CDP tracing) | ms | 同机 | record | ○ 定期一次 |
| `startup.welcome_webview_ms` | 开窗 → welcome webview did-finish-load(D1) | ms | 同机 | record | ○ |

### ② 交互(采集:`perf:scenarios` 经 CDP 驱动 + `__pulsePerf`;场景:`typing`✅ `drag`✅ `panzoom`✅ `mindmap_drag`○)

| 指标 ID | 定义(口径) | 单位 | 可比性 | 等级 | 状态 |
|---|---|---|---|---|---|
| `interact.<s>.inp_p95_ms` | 场景窗口内 Event Timing(含 interactionId)duration p95 | ms | 同机 | warn→gate | ✅ typing 48 / drag 128 @100节点 |
| `interact.<s>.frames_over20_pct` | rAF 帧间隔 >20ms 占比 | % | 同机 | warn | ✅ typing 43% @100节点 |
| `interact.<s>.loaf_blocking_ms` | 长动画帧 blockingDuration 合计 | ms | 同机 | record | ✅ |
| `interact.<s>.counter.nodes_array_replace` | 场景内整 nodes 数组替换次数(A2/I-1 守卫) | 次 | **全局** | **gate** | ✅ typing 120≤132 / drag 91≤100 |
| `interact.<s>.counter.canvas_save_ipc` | 场景内 canvas:save 发起次数 | 次 | **全局** | **gate** | ✅ ≤3 |
| `interact.<s>.counter.terminal_fit` | 场景内 xterm refit 次数(E2/E9 守卫) | 次 | **全局** | gate | ◐ 已埋,待含终端场景 |
| `interact.scale.inp_ratio_100_3` | 同场景 100 节点 / 3 节点 INP p95 之比(规模退化系数) | 倍 | 全局(近似) | warn | ○ 由 repeat 派生 |

### ③ 体积(采集:`perf:bundle`,构建产物静态度量;全部机器无关)

| 指标 ID | 定义(口径) | 单位 | 可比性 | 等级 | 状态 |
|---|---|---|---|---|---|
| `bundle.entry_raw_kb` | index-*.js 原始字节(北极星;目标 ≤1500) | KB | 全局 | **gate** | ✅ 4618 |
| `bundle.entry_gzip_kb` | 同上 gzip -9 | KB | 全局 | **gate** | ✅ 1015 |
| `bundle.total_js_kb` | assets/*.js 合计 | KB | 全局 | **gate** | ✅ 10580 |
| `bundle.chunk_count` | JS chunk 数 | 个 | 全局 | record | ✅ 51 |
| `bundle.lazy_boundary_watchlist` | WATCHLIST 包保持动态加载(静态 import-graph) | bool | 全局 | **gate** | ✅ mermaid |
| `bundle.heavy_in_entry` | 重依赖探针命中集(xterm/tiptap/hljs/d3/MF) | 集合 | 全局 | record | ✅ 5/6 在 entry |
| `bundle.entry_dep_kb.<dep>` | entry 内各重依赖归因体积(treemap) | KB | 全局 | record | ○ M1 |

### ④ 内存驻留(采集:`__pulsePerf` JS 堆 + `app.getAppMetrics()`;核心是斜率不是单点)

| 指标 ID | 定义(口径) | 单位 | 可比性 | 等级 | 状态 |
|---|---|---|---|---|---|
| `memory.ws_cycle.heap_slope` | 切 5 workspace ×3 轮回原点,每轮末 GC 后 JS 堆的线性回归斜率(北极星;健康 ≈0,H1 守卫) | MB/轮 | 全局(近似) | warn→gate | ○ M1 最高优先 |
| `memory.ws_cycle.rss_slope` | 同场景全进程 RSS 合计斜率 | MB/轮 | 同机 | warn | ○ |
| `memory.baseline.total_rss_mb` | 欢迎画布稳态全进程 RSS(含 Xvfb) | MB | 同机 | record | ✅ 568 |
| `memory.n100.total_rss_mb` | 100 节点画布稳态 | MB | 同机 | record | ✅ 726 |
| `memory.image.decoded_mb` | 注入 10×4K 图前后 GPU/renderer 内存差(K-1 守卫) | MB | 同机 | record | ○ |
| `memory.webview_guest_count` | guest WebContents 进程数(H2 守卫) | 个 | 全局 | record | ○ |
| `memory.soak30.heap_growth_mb` | 30min 空闲+周期操作后堆净增长 | MB | 同机 | warn | ○ M2 nightly |

### ⑤ 主进程健康(采集:main 侧采样器〔待建,镜像 `__pulsePerf` 模式,env 门控〕+ I/O 字节计数器)

| 指标 ID | 定义(口径) | 单位 | 可比性 | 等级 | 状态 |
|---|---|---|---|---|---|
| `main.loop_delay_p99_ms` | 场景窗口内 monitorEventLoopDelay p99(北极星;E/J 维总汇) | ms | 同机 | warn→gate | ○ M1 |
| `main.loop_delay_max_ms` | 同窗口最大值(单次冻结上限) | ms | 同机 | warn | ○ |
| `main.canvas_save.write_bytes` | 单次 canvas:save 实际落盘字节(B3 修复标尺) | KB | 全局 | gate | ○ M1 |
| `main.canvas_save.files_written` | 单次 save 写文件数(未变更应跳过) | 个 | **全局** | **gate** | ○ M1 |
| `main.session_persist.bytes_per_turn` | 每 agent turn 会话持久化字节(J-1 标尺,修复后应 O(增量)) | KB | 全局 | gate | ○ |
| `main.pty.ipc_per_sec` | 双终端流式时 pty:data IPC 条数/秒(E3 合并 flush 标尺) | 条/s | 全局 | record | ○ 待 node-pty ABI |

### ⑥ AI 流式(采集:mock 回放场景〔M3,需先评审侵入面〕+ 已埋计数器;fixture:3 代码块 + 1 mermaid 定速回放)

| 指标 ID | 定义(口径) | 单位 | 可比性 | 等级 | 状态 |
|---|---|---|---|---|---|
| `chat.stream.frames_over20_pct` | 回放期帧超率(北极星) | % | 同机 | warn→gate | ○ |
| `chat.stream.md_cache_hit_ratio` | cache-hit /(hit+render)(F1/F2 修复守卫) | % | **全局** | **gate** | ◐ 计数器已埋 |
| `chat.stream.tail_burst_ms` | 流结束 → 全部 mermaid 渲染完(F4/F5 守卫) | ms | 同机 | warn | ○ |
| `chat.mermaid.render_ms` | 单图 mermaid.render 耗时 | ms | 同机 | record | ○ |

## 3. 采集与记录规范

**命名**:`<专项>.<场景>.<指标>`,计数器加 `counter.` 段;场景无关的省场景段。

**记录 schema**(每次运行 append 一份到 `perf/history/<yyyy-mm-dd>-<commit>.json`):

```json
{
  "commit": "be8defb", "timestamp": "…", "machineId": "<hostname-hash>",
  "env": { "os": "linux", "cores": 4, "headless": true },
  "metrics": [
    { "id": "interact.typing.counter.nodes_array_replace", "value": 120, "runs": 1 },
    { "id": "interact.typing.inp_p95_ms", "value": 48, "runs": 3, "raw": [46, 48, 51] }
  ]
}
```

**三条铁律**:
1. 时间类指标**按 machineId 分基线**,永不跨机比绝对值;计数类全局同一基线。
2. 门禁等级只升不降(record → warn → gate),升级条件:同机 ≥5 次历史且方差 < 容差的一半。
3. **修复联动**:修一个发现,同 PR 下调其守卫指标的基线/max(如修 I-1 后 `nodes_array_replace` max 132→20)。

## 4. 路线图

- **M1(填空格)**:④ 切换循环+堆斜率 → ⑤ loop-delay+写字节 → ② repeat+panzoom → ③ treemap → `perf:all` 一键全跑。
- **M2(门禁化)**:history/趋势上看板 → 时间指标按铁律 2 升级 → CI workflow(补 `harness/validate/validation.yaml` runner 缺口)→ soak 进 nightly。
- **M3(修复联动)**:修 I-1/J-1/J-2/K-1/H1 并下调基线 → chat 回放入口(评审后)→ 终端流式(解 node-pty Electron ABI)。

**完成态判据**:六专项北极星指标全部 ≥warn 级、计数器全部 gate 级、CI 每 PR 跑体积+计数器、nightly 跑全量、看板趋势区有数据。
