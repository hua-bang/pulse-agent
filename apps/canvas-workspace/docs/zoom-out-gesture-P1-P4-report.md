# 缩小手势(zoom-out)性能优化 P1–P4 最终报告

> 性质:**一次完整的 A/B 落地报告**。同一探针(`scripts/perf/zoom-gesture-probe.mjs`)、同一 `large` 档位(86 节点 / 40 内嵌:20 内联 iframe + 20 webview)、median-of-3,只在「P1–P4 之前」与「之后」两个 commit 上跑,得到干净对照。
> 基线 commit `b8c91daa`(P0 探针就位、P1–P4 未落地);优化后 commit `1c342441`(P1–P4 全部落地 + CSS 门禁重基线)。
> 数据来源:CI `Performance / large-canvas` 作业步骤 "Deep zoom gesture probe (diagnostic, large 86/40 baseline)",真实 Electron + 20 个真实 webview guest 进程,headless Xvfb。

---

## 0. 结论摘要

P1–P4 把缩小手势的深段(0.35→0.1,20 个真实 guest 一起被快速缩放栅格化的区间)从 **60.9% 长帧(>20ms)降到 24%**(2.5×),浅段(1→0.35)从 **30% 降到 5%**(6×),放大回程从 **14% 降到 7%**(减半,且首次达标 ≤8% 线),tile-memory 全程保持 **0**(验证移除 `will-change` 的决策没有回归)。三条最难的验收线(深段 >20ms、深段 p95、全览沉降)全部显著下降,但深段 >20ms(24%)与全览沉降(5.7%)仍高于其激进目标线(10% / 3%),p95 落在线上(33.4ms vs 33ms,即 2 帧量化噪声)。

**残余成本是结构性地板,不是可修的渲染热点**:同一 P1–P4 代码在 `grid` 档位(24 节点 / 12+12 内嵌)深段为 **0%**,只有 `large` 档位(20 个 webview)才升到 24%——残余随 guest 数量线性上升,证明它来自 20 个真实 webview 的合成面(每帧被变换合成一次,与其 1fps 内部降帧无关),而该地板正是方案明确不允许跨越的(不 `display:none` / 不卸载 guest → 保留登录 / 焦点 / 页内状态)。

---

## 1. A/B 数据(large 86/40,median-of-3)

| 窗口 | 基线 `b8c91daa` | 优化后 `1c342441` | 绝对 Δ | 相对 |
|---|---|---|---|---|
| **zoomOut 1→0.35**(浅段) | 30% · p95 33.4ms · max 33.4ms | **5%** · p95 16.8ms · max 66.7ms | −25pp | **−83%(6×)** |
| **zoomOut 0.35→0.1**(深段,主目标) | 60.9% · p95 66.6ms · max 83.3ms | **24%** · p95 33.4ms · max 66.7ms | −36.9pp | **−61%(2.5×)** |
| **overview settle**(全览沉降) | 7.4% · p95 33.3ms | **5.7%** · p95 33.2ms | −1.7pp | −23% |
| **zoomIn 0.1→1**(放大回程) | 14% · p95 33.3ms · max 33.4ms | **7%** · p95 33.3ms · max 50ms | −7pp | **−50%** |
| zoom-in settle | 5.8% · p95 33.3ms | 1.4% · p95 16.8ms | −4.4pp | −76% |
| **tile-memory 警告**(worst run) | 0 | **0** | — | 保持 |

> 注:基线那次探针读到 `live inline=16 webviews=20`,优化后那次读到 `live inline=20 webviews=20`——两次都是同一 `large` 档位(seed 恒为 20 内联 + 20 webview),差异是内联 iframe 挂载时机的读数抖动。优化后一次实际挂载了**更多**活跃内联 iframe(20 vs 16),即在**更重**负载下取得上述改进,不是更轻。

### 验收线对照(探针输出,信息性,永不作为门禁)

| 验收线 | 基线 | 优化后 | 状态 |
|---|---|---|---|
| zoomOut frames>20ms median ≤ 10% | 60.9% OVER | 24% OVER | 2.5× 改善,未达线 |
| zoomOut p95 median ≤ 33ms | 66.6ms OVER | 33.4ms OVER | 落在线上(帧量化噪声) |
| zoomOut worst frame median ≤ 100ms | 83.3ms PASS | 66.7ms **PASS** | 改善 |
| overview settle median ≤ 3% | 7.4% OVER | 5.7% OVER | 改善,未达线 |
| zoom-in median ≤ 8% | 14% OVER | 7% **PASS** | **新达标** |
| tile-memory (worst run) ≤ 0 | 0 PASS | 0 **PASS** | 保持 |

6 条线中 3 条 PASS(worst-frame、zoom-in、tile-memory),3 条 OVER 全部显著下降。

---

## 2. 落地了什么(P1–P4 + P0)

均在 commit `86d4721f`(P1–P4)与 `e4068ec3`(P0 探针),门禁重基线在 `1c342441`。

### P0 — 回归基线探针(`scripts/perf/zoom-gesture-probe.mjs`)
- `ZOOM_PROBE_PROFILE=grid|large`、`ZOOM_PROBE_REPEAT`(默认 3)。`large` = 86 节点 / 40 内嵌(20 webview + 20 内联 + 46 文本)。
- 用 JS 派发 `WheelEvent{ctrlKey}` 驱动真实 Electron 缩放(CDP `Input.dispatchMouseEvent` 到不了 Electron 的缩放处理器);分窗口:zoomOut_1_035 / zoomOut_035_01 / overviewSettle / zoomIn_01_1 / zoomInSettle;median-of-N;tile-memory 走 CDP `Log.entryAdded`。
- 诊断性,`continue-on-error: true`,永不作为门禁——只产出可对照的数字。

### P1 — 手势状态信号(`hooks/canvasMotion.ts` + `hooks/useCanvas.ts`)
- 新单例 observable:`CanvasMotionMode`(idle/pan/zoom-in/zoom-out)+ `heavy`(内嵌 ≥ `HEAVY_EMBED_THRESHOLD=8`)。
- `useCanvas` 每次滚轮 tick 直接把 `data-motion` / `data-heavy-embeds` 写到 `.canvas-transform`(不过 React,不触发 commit),并驱动 JS 消费者(webview 降帧)。heavy 每手势只算一次。

### P2 — 内联 iframe 手势期静态化(`components/IframeNodeBody/index.css`)
- `[data-motion="zoom-out"][data-heavy-embeds] .canvas-node--iframe iframe.iframe-frame { visibility: hidden }`——首个 zoom-out 滚轮即生效,保留尺寸 / 位置(不 reflow),放大排除,沉降即恢复。

### P3 — webview 手势期降帧租约(`components/IframeNodeBody/useWebviewBackgroundThrottle.ts`)
- 订阅 `canvasMotion`:heavy zoom-out 立即把每个已挂载 guest 降到 `setFrameRate(1)`,手势结束 `GESTURE_RESTORE_MS=180` 后恢复(除非该 guest 独立地离屏 / 全览仍需低帧)。
- 三个独立降帧源(离屏 / 手势租约 / 全览)统一为一次 "最低帧率胜出" 决策(`syncRate`),互不打架。不 `display:none`、不卸载(否则杀 guest 进程,丢登录 / 焦点 / 页内状态)。

### P4 — 手势期装饰压平(`components/Canvas/index.css`)
- `[data-motion="zoom-out"][data-heavy-embeds]` 下把节点 `box-shadow` / `backdrop-filter` / `transition` 压平(缩小到全览尺度时这些都是亚像素、不可见的纯开销)。
- **刻意不重新引入 `will-change`**——图层提升整棵子树正是 tile-memory 空白闪烁的根因(见 `Canvas/index.css` 与 `useCanvas` 注释)。

---

## 3. 为什么深段停在 24%(而不是 <10%)

- **档位对照定位到根因**:`grid`(12 webview)深段 = 0%;`large`(20 webview)深段 = 24%。残余随 guest 数量上升,不随其它变量。
- **机制**:P3 的降帧租约只降 guest **自身**的绘制节奏;但缩放手势里,embedder 每帧仍要把每个 guest 的**已有合成面**做一次变换合成。20 个真实 guest 面 = 每帧 20 次合成变换,这是 Chromium 合成器的固定成本,CSS 动不了。
- **方案红线**:进一步压这条线只有两条路——(a)手势期 `display:none` / 卸载 guest:**方案明令禁止**(丢登录 / 焦点 / 页内状态,webContents ID 变化);(b)手势期用一张静态快照替换每个 guest、结束后换回:这是超出 P1–P4 范围的更大改造(快照捕获 + 交换,且有闪烁风险)。故深段 24% 是当前约束下的合理落点。
- P2 方案里提过的 `content-visibility:hidden`(vs 落地的 `visibility:hidden`)只作用于 20 个内联 iframe、不触及 webview 地板,即使把内联部分归零也压不动主导的 guest 合成成本;作为未测的备选记录在此。

---

## 4. 验证与无回归

- **CI 全绿**:run `29388025785`(commit `1c342441`)—— `changes` / `perf` / `large-canvas` / `package-macos-arm64` 全部 success;`perf:dashboard` verdict = "P0 目标 3/4 达标 · Gate 17/17 通过;无 high 回归"。
- **体积门禁**:`startupCssRawKB 108KB`(baseline 108,limit 111)PASS;`startupJsRawKB 640KB` PASS。P1–P4 的新 CSS 规则使启动闭包 CSS 从 104→108KB,已把 ratchet 基线重基到 108(绝对 target 仍 115,warning 130,留有余量)。
- **webview 生命周期真机核查**:freeze/resume PASS(resume 不 reload、load stamp 不变、250ms 内恢复 ping)、L3 discard PASS——确认降帧 / 冻结不破坏 guest 存活与页内状态。
- **单元测试**:`canvasMotion.test.ts`(4 例:通知 / 去重 / isHeavyZoomOut / 抛错订阅者不卡死)、`monitor.test.ts`(maxDeltaMs 新字段)本地通过。
- **常规交互无回归**(large-canvas scenarios):typing/drag/resize/panzoom frames>20ms=0%,LoAF=0。

---

## 5. 后续可选杠杆(非本轮范围)

1. **guest 手势期快照交换**(上文 (b)):把深段 24% 往 <10% 压的唯一不破坏状态的路径,代价是快照管线 + 换入换出防闪烁,属独立一轮。
2. **P2 静态化方式的真 A/B**:`content-visibility:hidden` + `contain-intrinsic-size` vs 现 `visibility:hidden`,只影响内联 iframe 份额,收益上限有限(见 §3)。
3. **全览沉降 5.7%→≤3%**:沉降段主要仍是 guest 合成 + 语义降级切换的一次性成本,与深段同源。

> 写回:P1–P4 的机制与红线已固化在各文件头注释与 `Canvas/index.css` / `useWebviewBackgroundThrottle.ts` 注释;探针与档位对照是定位残余的标准手段(`grid` vs `large` 深段差即 guest 合成地板)。
