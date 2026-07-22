# 大画布真实负载性能核查（86 节点 / 40 iframe）

> 性质:**点状现状核查**,不是第四轮扫描。基线 commit `ec6e0de`(2026-07-13)。
> 输入是一份脱敏的真实用户画布画像:86 节点 = 19 frame + 40 链接/iframe/HTML(约 25 外部网页 + 8 本地 HTML + 7 srcdoc/Mermaid)+ 13 文本 + 8 markdown 文件 + 3 图片 + 2 思维导图 + 1 运行中 agent。
> 方法:对照该负载的 10 个疑点,逐项回真实代码核实"已修 / 部分实现 / 未实现",并标注与 `performance-analysis-consolidated.md` 发现编号的对应关系。已修项不再重复展开,重点是**当前 HEAD 仍然成立的缺口**。

---

## 结论摘要

交互热路径(pan/zoom/drag/resize/连线)经 B7/B9/V2 等修复后已经干净,**不再是这类画布的瓶颈**。对"86 节点、40 iframe"负载,当前代码仍然成立的系统性成本按影响排序:

1. **约 15 个非 url 型 iframe(本地 HTML / srcdoc / dynamic-app)零生命周期管理**——无懒挂载、无降帧、无占位,画布加载即全部创建,离屏后 JS/动画/Observer 满速常驻(H2/H4 残留面)。
2. **url 型 webview 懒挂载是单向门**——浏览经过即永久创建 guest 进程,永不回收;25 个外部页稳态 = 25 个常驻 Chromium guest 进程,降帧只降绘制,JS/timer/网络全速(H2 设计如此)。
3. **无视口裁剪**——86 个节点 body 全部常驻挂载(A1/H1 出专项未动);宿主侧唯一离屏优化是 `content-visibility:auto`,且 agent/terminal/webview/mindmap 被排除在白名单外。
4. **终端/agent 每 2s 全画布管线**——scrollback 自动保存仍走 `updateNode → 全数组替换 + 入 undo 栈 + 全画布序列化落盘`(B1/B4/B5/A5 残留;getCwd 异步化 E1 已修,但触发结构未变)。
5. **无截图占位/休眠恢复机制**(有意决策,见 §5),**无节点归档能力**(§8),**性能基线未覆盖 iframe 重负载档位**(§10)。

19 个 Frame 本身不是问题:`resizeGroupsToChildren` 只作用于 `group`,frame 从不自动重算包围盒,无级联(§6)。

---

## 逐项核查

### 1. 离屏 iframe/WebView 是否仍在渲染、执行 JS —— 分型,url 型部分缓解,其余未缓解

| 类型(对应画像) | 挂载元素 | 懒挂载 | 离屏降载 |
|---|---|---|---|
| url 外部网页(~25) | `<webview>` guest 进程 | ✅ IntersectionObserver,200px,**单向** | ✅ 离屏 300px+1500ms 后 `setFrameRate(1)`,仅降绘制 |
| 本地 HTML / srcdoc / AI / artifact(~15) | 内联 `<iframe>`(`IframeRenderedView.tsx:246-262`) | ❌ 无条件渲染 | ❌ `disabled: mode !== 'url'`(`useIframeNodeState.ts:196-201`) |
| dynamic-app | 内联 `<iframe>`(`DynamicAppNodeBody/index.tsx:147-152`) | ❌ | ❌ 无任何 observer |

- 降帧机制:`useWebviewBackgroundThrottle.ts:51-54,84,96-119` → IPC `iframe:set-frame-rate` → `wc.setFrameRate`(`main/webview/registry.ts:283-309`)。主进程注释自证:"only the paint cadence drops, so **JS execution, timers, and network continue at normal speed**"。
- 不卸载、不导航 `about:blank`、不改 `visibilityState`,均为文件头注释里的显式设计决策(`useWebviewBackgroundThrottle.ts:3-27`:unmount 杀 guest 进程丢状态;visibilitychange 会触发页面自拆)。
- `setFrameRate` 只对 webview guest 有效,对渲染进程内联 iframe 本就无效——所以非 url 型**结构上无法用现机制降载**。
- 用户画像中的"about:blank Mermaid 渲染页"即 srcdoc 分支(`IframeRenderedView.tsx:251`),Mermaid 脚本在 iframe 文档内运行,完全不受画布可见性控制。

### 2. iframe 是否画布初始化全加载 —— url 型有懒挂载但不回收;非 url 型全量立即加载

- url 型:`useDeferredVisibleMount.ts:15-41` —— IntersectionObserver(root=浏览器视口,rootMargin 200px,无 zoom/面积阈值),`isIntersecting` 即挂载并 `observer.disconnect()`,**挂载后永不再卸载**。首屏只创建视口 ±200px 内的;但用户平移浏览全画布一遍后 25 个 guest 全部常驻。
- 非 url 型 + dynamic-app:进 DOM 即创建,无门控。
- **无任何并发上限**(节点级;`MAX_BACKGROUND_WORKSPACES=3` 是工作区级)。40 节点稳态 = 25 guest 进程 + 15 内联 iframe。

### 3. 缩放/拖动是否触发全 86 节点 React 重渲染 —— 已修,且稳固

- pan/zoom 手势直写 DOM transform + rAF 合并(`useCanvas.ts:71-99`),整段手势只有 2 次 React commit(`markMoving`/静置 180ms 后 settle,`useCanvas.ts:134-147`);`--canvas-scale` 手势期冻结(`:66-68`,ef0b605)。
- `CanvasNodeView` 为 `React.memo` 自定义比较器(`CanvasNodeView/index.tsx:225-249`);`moving` 不作为节点 prop,86 节点全部 bail-out。
- 对应 cc25f10 / 4e8d20d / ef0b605 / 1a6bcd7,全部在位。

### 4. 位置/尺寸/连线是否 pointer move 高频计算 —— 已修

- 拖拽:ephemeral `dragOffset`,只有被拖节点重渲染,`moveNode` 仅 pointer-up 提交一次(`useNodeDrag.ts:272-327`,B7)。拖拽中**边零重算**(edges 不跟随 dragOffset,提交时跳变,`CanvasSurface.tsx:233-236`)。
- resize:ephemeral `resizePreview`,每帧 1 节点重渲染 + O(n) 投影数组 + 边层跟随重算(`useNodeResize.ts:177-236`,B9/V2)。
- 边层 `React.memo` + 端点按 `[edges, nodesById]` memo(`CanvasEdgesLayer.tsx:182-213,393-404`)。
- 回归护栏:`interact.{typing,drag,resize}.counter.nodes_array_replace` gate max 10(`perf/baselines.json`)。

### 5. HTML/WebView 是否有截图占位、休眠恢复 —— 未实现(有意决策待重审)

- 全仓无画布节点级 snapshot/capturePage 占位(命中均属 agent screenshot 工具、节点列表页缩略图、DOM picker 等无关子系统)。
- `useWebviewBackgroundThrottle.ts:14-17` 注释明确否定此路线("coming back to the node is instantaneous"——靠保活换即时恢复)。该决策在"个位数 webview"下合理;在 25+ guest 常驻的负载下,进程数与内存代价需要重新权衡(见文末方向 2)。

### 6. Frame 是否因子节点变化重复计算包围盒 —— 与直觉相反:frame 不参与自动包围盒

- `resizeGroupsToChildren.ts:13,17-22`:首行 `type === 'group'` 早退,循环内非 group 原样返回。**19 个 frame 从不自动 resize,无级联**。
- 真实的固定税:每次 nodes 数组替换付 `computeParentContainerMap` ×2(`useCanvasVisibility` 折叠过滤 + `useCanvasRenderOrder` 深度排序,`frameHierarchy.ts:63-107`),86 节点 × ~20 容器 ≈ 3.4k 次迭代/次 + sort。单次不贵,**贵在触发频率由 §9 的 2s 自动保存决定**。
- 另:`useCanvasVisibility` 命名有误导——它只做折叠 frame 后代过滤,**不是视口裁剪**;真正的视口裁剪不存在(A1/H1,已立项出专项未动)。宿主侧仅 `content-visibility:auto` 白名单(frame/group/text/shape/image/reference + 非选中 file,`CanvasNodeView/index.css:20-47`),agent/terminal/webview/mindmap 被排除(xterm 离屏 0×0 问题)。

### 7. Mermaid、动画、ResizeObserver 是否离屏启停 —— 不启停

- iframe 节点体内的 `ResizeObserver` 在 **guest/iframe 文档内**(`artifacts/streamingShell.ts:56,76`,经 postMessage 回报高度),画布的 IntersectionObserver 管不到;parent 端 message 监听(`useIframeNodeState.ts:129-153`)也不随可见性解绑。
- srcdoc iframe 内的 Mermaid/CSS 动画不受降帧影响(§1);流式渐变动画离屏照 tick(round3 K-3)。
- 渲染进程内无任何"节点离屏 → 暂停 observer/动画"代码路径。
- 另一个常驻项:**每个有 `updatedAt` 的节点挂一个 30s `setInterval`** 刷新相对时间(`useCanvasNodeViewModel.ts:80-87`),86 节点 = 86 个常驻定时器,与视口无关(consolidated A7,未修)。

### 8. 历史节点能否归档、主画布留引用 —— 产品能力不存在

- 现有能力是"**添加引用,源节点原地不动**":`reference` 节点 `ref: {kind:'workspace-node', workspaceId, nodeId}`(`shared/canvas.ts:144-153`),快照仅 title/type/workspace 名(`:343-347`);跨 workspace 粘贴自动转引用(`Workbench/index.tsx:249-291+`);可引用类型不含 terminal/agent/frame/group/dynamic-app(`utils/referenceNodes.ts:3-11`)。
- **没有**"移动节点到另一画布 + 原处留引用"的合并操作;canvas-cli node 子命令仅 list/read/write/create/delete(`packages/canvas-cli/src/commands/node.ts`),无 move/archive。
- 代码中 "archive" 均与节点归档无关(workspace 导出 zip、agent-teams JSONL、存储 .bak)。
- 短期人工工作流:历史版本节点剪切到归档 workspace(跨 workspace 粘贴会变引用,注意语义),或删除前先 workspace 导出 zip 留底。

### 9. Agent/终端输出虚拟化与缓存上限 —— 上限有,触发结构是问题

- 有上限:xterm `scrollback: 5000` 行(`config/terminalTheme.ts:79`);序列化 cap 50000 字符(`AgentNodeBody/utils/terminal.ts:7,45`)。xterm 本身 canvas 渲染,显示是视口化的。
- 仍成立的缺口(consolidated B1/B4/B5 + round3 L-3):每个活终端/agent 节点每 **2s**:
  1. 全量扫描 buffer 逐行 `translateToString` + join(`terminal.ts:35-47`);
  2. `onUpdate → updateNode`,**默认入 undo 栈**(`useNodes.ts:402-410` 未传 `addToHistory:false`)——Cmd+Z 会回退到一次 scrollback 自存而非用户动作;
  3. 整个 nodes 数组 `.map()` 替换 → §6 的容器管线 + 86 次 memo 比较;
  4. 800ms 防抖后**整画布 payload 落盘**(`useNodes.ts:83-95,111-116`)。
  - 离屏、隐藏、后台 workspace 均不暂停(`Canvas/index.tsx:547-549` 隐藏画布保持挂载)。1 个运行中 agent = 稳定的每 2s 全画布心跳。
- PTY `onData` 无帧级合并:主进程每 chunk 一次 IPC(`pty-manager.ts:286-292`),渲染端每 chunk `term.write`(E3,未修)。
- 已修对照:`getCwd` 已异步化(E1,`pty-manager.ts:208-233`);chat/AI 流式已 32ms 窗口合并(`textDeltaBatcher.ts` + `useChatStream.ts:152-168`)。

### 10. 性能基准与 profiling —— 设施完备,档位缺口明确

- 已有:`perf:report` 全链路(startup / typing / drag / resize / panzoom / chat-stream / pty-stream / image-memory / ws-cycle / renderer-trace CDP trace 含 Long Task/LCP);`--seed-nodes N` 任意规模;`--seed-webpages N` 可种真实 srcdoc iframe 节点(8e64568)。
- 缺口:门禁 profile 钉死在 **100 节点 / 0 seeded webviews**(`perf/baselines.json` `local-darwin-arm64-n100-r3`)。**当前没有任何基线覆盖"几十个 iframe"负载形态**——而本画像显示这正是真实用户画布的主形态。规模曲线任务 D6(3/100/300 节点)在 plan.md 里未动。
- CI:bundle gate 每相关 PR 必跑;完整 runtime 报告仅 runtime 改动 / `performance` label / master push 触发(`.github/workflows/perf.yml`)。

---

## 对该负载的成本画像(静态推断,待实测)

- **进程/内存下限**:全画布浏览一遍后,~25 个常驻 guest 进程(每个独立 Chromium renderer)+ 15 个在主渲染进程内跑 JS 的内联 iframe + 86 个常驻 React body(含 xterm/tiptap/mindmap 实例)。感知到的"卡"更可能来自整体内存/GPU 合成压力与 guest 进程数,而非交互热路径(后者已修干净)。
- **稳态心跳**:1 个运行中 agent → 每 2s 一次全画布管线 + undo 入栈 + 防抖落盘;86 个 30s 相对时间定时器;15 个非 url iframe 的动画/Observer 满速。
- 实测入口:`pnpm --filter canvas-workspace perf:report -- --seed-nodes 90 --seed-webpages 40` 可近似复现该形态;真实画布可用 `renderer-trace` 场景 + Chrome tracing / `app.getAppMetrics()` 验证 guest RSS 分布。

## 方向映射(与既有计划对齐,不新开口子)

1. **非 url iframe 懒挂载 + 离屏卸载/占位**(§1/§2/§7):复用 `useDeferredVisibleMount`,改双向 + 静态占位;对内联 iframe 无 setFrameRate 可用,卸载/占位是唯一降载手段。对应 consolidated H4,收益在本画像下从 low 升为首位。
2. **url webview 休眠策略重审**(§1/§5):单向门 + 保活设计在 25+ guest 下代价过高;需要产品决策(capturePage 占位 + 销毁/重建,接受回视口重载)。对应 H2 的"超越降帧"。
3. **scrollback/cwd 专用 patch 路径**(§9):不入 undo、不全数组替换、不整画布序列化——外部更新路径(`useNodes.ts:223-234`)已示范了绕开方式。对应 B1/B4/B5/A5。
4. **视口裁剪专项**(§4/§6):已立项(plan.md 决策 #1),本画像是其最强立项依据。
5. **基线补档**(§10):增加 `seedWebpages>0` profile + D6 规模曲线,把"iframe 重负载"纳入回归护栏,先于大改动落地。
6. 小项:86 个 30s 定时器合并单 ticker(A7);PTY onData 帧级合并(E3);离屏 CSS 动画 `animation-play-state: paused`(K-3)。

## 实测补充(2026-07-13,Chromium 渲染端台架)

本沙箱的出口策略拒绝 Electron 二进制下载(`www.electronjs.org`、`npmmirror.com` 均 CONNECT 403;GitHub release/API 仅放行本仓库),`perf:report` 完整运行时链路无法执行。作为兜底新增 `scripts/perf/renderer-bench/`:本地 HTTP 托管 `dist/renderer` 构建产物,在预装 Playwright Chromium 里以 init-script 注入 `window.canvasWorkspace` 桩 + 与本画像同构的 86 节点 fixture(19 frame / 40 iframe / 14 text / 8 file / 3 image / 2 mindmap;iframe 全部 `mode:'html'` srcdoc,其中 15 个含 rAF/interval/CSS 动画/ResizeObserver/MutationObserver),真实 React 渲染管线端到端运行,零报错。同日 `perf:report --bundle-only` 实测 **7/7 体积门禁通过**(入口归因:app 自身 838KB + react-dom 131KB)。

实测(Xvfb 有头、软件渲染、1600×900、scale 1;**A/B 相对差是信号**,软件栅格使 zoom 类绝对值偏悲观、无 GPU 合成路径;`<webview>` 由同进程 iframe 代演):

| 场景 | full(15/40 动画) | static-iframes | no-iframes |
|---|---|---|---|
| 挂载到 86 节点 | 521ms / 长任务合计 295ms(max 160) | 525ms / 286ms | 332ms / 140ms(max 85) |
| 挂载即真实 iframe(视口外) | 40 个(36 离屏) | 40(36) | 0 |
| 初始视口稳态 10s(动画均离屏) | 0.3% 帧超 / 任务 0.22s | 0% / 0.26s | 0.3% / 0.10s |
| 平移(wheel 空白区) | 4.9% 帧超,0 长任务 | 3.3% | 0% |
| 缩放(ctrl+wheel) | **42% 帧超,44 长任务共 4.1s,帧 p95 133ms** | 10.6%,1 长任务 | 0.6% |
| 拖拽 iframe 节点 | **90.8% 帧超,INP p95 328ms** | 51.1% | —(拖文本节点:7%) |
| 巡览全画布后驻留(30 iframe 在屏) | 8.3% 帧超,帧 p95 33ms | (驻留点无 iframe)0% | 0% |

**确认与修正:**

1. **确认(§1/§2):html 型 iframe 无懒挂载**——挂载完成瞬间 40 个真实 iframe 全部在 DOM,36 个在视口外。40 个 iframe 把 86 节点挂载的长任务阻塞从 140ms 抬到 ~290ms(2.1×)。
2. **确认(§3/§4):React 交互管线干净**——pan 全程 0 长任务、无 nodes-array 计数;拖文本节点仅 7% 帧超;每次拖拽 `canvas-save-ipc`=1(提交一次)。B7/B9 修复在真实渲染链路成立。
3. **新信号:缩放与拖拽 live iframe 是最大交互放大器**——42%/91% 帧超几乎全部来自 live iframe 的重栅格/重合成,动画使其显著恶化(static 对照 10.6%/51%)。这直接对应"缩放、拖动卡"的体感。
4. **修正(§7 部分):离屏*同进程* iframe 的稳态成本低于静态推断**——Chromium 自身暂停离屏 iframe 的 rAF/绘制并钳制定时器,初始视口稳态三变体都接近满帧。真实 app 的稳态痛点据此更集中于:(a) 25 个*跨进程* webview guest(浏览器离屏节流不适用,只有 app 的 1fps 降帧,JS/网络满速——本台架无法复现,待真机 `app.getAppMetrics()` 验证);(b) 在屏动画 iframe(驻留 8.3% 帧超);(c) agent 2s 心跳(本台架无 PTY,未复现)。
5. 内存:srcdoc 页面极小(JS heap 13-18MB),不代表真实外部 SPA 的 guest 进程内存,guest RSS 待真机。

**优先级修订(对照上文"方向映射"):** 实测支持方向 1(非 url iframe 懒挂载/占位)与 2(webview 休眠)继续居首,但落点更准——懒挂载的主要收益在**挂载阻塞**与**缩放/拖拽时的 live-iframe 栅格**,而非离屏稳态 CPU;方向 6 中"离屏动画启停(K-3)"在同进程 iframe 上已被 Chromium 兜住,可降级;新增一个短平快候选:**缩放/拖拽手势期给 live iframe 盖静态化层**(手势中暂停 iframe 合成或快照占位,手势结束恢复),直接砍掉 42%/91% 帧超的大头。

### 卡顿归因(Chrome trace 分解,`trace.mjs`)

对 full 变体的三个状态各抓一段 trace(线程×事件桶分解;缩放前校验 transform 真实变化——wheel 落在节点/iframe 上会被吃掉,同 plan A4 的坑):

| 状态 | 帧超 | 主要成本(窗口内累计) |
|---|---|---|
| 稳态 idle(scale 1,动画均离屏) | 0.2% | script 168ms/10s——干净 |
| 拖 iframe 节点(scale 1,1 个 live iframe 在屏) | **2%** | script 260ms + raster 246ms/1.8s——可接受 |
| 缩放手势(1 → min 0.1,穿越全览) | **39.9%** | **raster 2993ms + script 2793ms + Layerize 2363ms** + layout 1489ms + paint 962ms / 8.2s |
| 全览 scale(0.1,40 iframe 全部同屏)下拖拽 | **55%** | **script 1985ms(FireAnimationFrame 1018ms)+ Layerize 2071ms** / 4.9s |

**结论:卡顿 ≈ f(视口内 live iframe 数 × scale 变化)。**
1. 缩放穿越小 scale 时,40 个 live iframe 同时进入视口且随 scale 逐帧重栅格(raster 桶最大),40 个合成层导致 `Layerize`(层树重建)本身就有 2.3s;
2. 一旦停在全览 scale,Chromium 的离屏节流全部失效——15 个动画 iframe 的 rAF 同时复活(`FireAnimationFrame` 1018ms),此时**任何**交互都是 55% 帧超;
3. scale 1 下同样的拖拽只有 2% 帧超——第一轮 run.mjs 里 91% 的拖拽帧超,经复核是场景顺序副作用(缩放场景结束后停在 0.1 全览 scale,拖拽实际在全览态测的),修正后两种状态分别为 2% / 55%,更能说明问题:**全览态才是重灾区**。
4. 这与大画布的真实使用方式正面相撞:节点越多,用户越依赖缩小导航——最常用的姿势恰好是最坏的性能状态。修复方向 1/2 与"手势期静态化层"应优先针对**小 scale/全览态**生效(如 scale < 阈值时 iframe 一律切占位/快照,即"语义缩放")。

### 第一刀优化与复测:全览语义缩放(2026-07-13)

按上面的归因落的第一个修复:`CanvasSurface` 新增 `OVERVIEW_SCALE_THRESHOLD = 0.35`,settled scale 低于阈值时根节点挂 `canvas-transform--overview` 类(复用既有 `--small`@0.6 的机制,基于 settledScale——手势期冻结,每手势只翻转一次);`IframeNodeBody/index.css` 在该类下把 `.canvas-node--iframe .iframe-frame` 置 `display:none`(iframe 文档与 JS 状态保留,渲染层丢弃、rAF/CSS 动画暂停)并显示反向缩放的占位。url 型 `<webview>` 不受影响(隐藏 webview 有 guest 副作用,其成本已被 1fps 降帧兜底)。纯函数 `getCanvasTransformClassName` + 阈值常量有单测(`CanvasSurface.test.ts`)。

同台架同场景复测(优化前 → 优化后):

| 场景 | 优化前 | 优化后 |
|---|---|---|
| 缩放手势(穿越全览) | 39.9% 帧超;raster 2993ms / script 2793ms / Layerize 2363ms / layout 1489ms(8.2s 窗口) | **16% 帧超;raster 974ms / script 297ms / Layerize 704ms / layout 325ms(3.8s 窗口)** |
| 全览态拖拽 | 55% 帧超;script 1985ms(FireAnimationFrame 1018ms)+ Layerize 2071ms | **22.9% 帧超;script 109ms(动画项从 top events 消失)+ Layerize 1749ms** |
| 稳态 idle(scale 1) | 0.2% 帧超 | 0.2%(无回归) |
| 拖拽(scale 1,live iframe 在屏) | 2% 帧超 | 2%(无回归) |

行为验证(Chromium 截图 + DOM 断言):全览态 40 个 iframe 节点全部切为占位(可见 iframe 数 40→0),缩回正常 scale 后全部恢复(0→40,类名清除),srcdoc 状态经 `display:none` 保留不重载;10% 缩放下画布截图确认占位/Frame 标题/文本节点渲染正常。

**残余瓶颈(已解决,见文末"残余优化"段)**:全览态拖拽仍有 22.9% 帧超,现在由 `Layerize`(1749ms)主导——86 个节点全部在视口时合成层树重建仍贵;下一杠杆是压全览态的层数(如对更多节点类型在 overview 下走 `content-visibility` / 扁平化节点 chrome),或全览态拖拽走截图层。→ 后续二分定位:层数元凶是 `--small` 档 86 个 `opacity:0` 的 backdrop-filter 动作浮层,`display:none` 后 Layerize 1826→207ms、帧超→1%。缩放手势期(iframe 尚未隐藏、settledScale 未翻转前)的 raster 也仍有 ~1s,如需进一步压,可在手势中即时按目标 scale 预切换。

### 指标观测现状(能不能持续看到"为什么卡")

已有的观测(全部是**实验室/opt-in**,默认零开销):
- `window.__pulsePerf`(常驻安装、被动):场景窗口内的 INP、LoAF、longtask、帧分布、JS 堆、领域计数器(`perf/monitor.ts`);
- 确定性计数器 `nodes-array-replace`/`canvas-save-ipc` 等(`perf/counters.ts`,默认关闭);
- main 进程 loop-delay 采样器 + 保存 IO 计数(`PULSE_CANVAS_PERF=1` 门控);
- `perf:report` 全链路:场景采集 + baselines 棘轮门禁 + history 趋势 + CI(perf.yml)+ warm-reload CDP trace。

缺口(本次实测直接暴露的):
1. **没有任何指标记录"负载状态"维度**——当前 scale、视口内 live iframe/webview 数、动画中的 guest 数。本次证明这是卡顿第一因子,但现有指标体系对它不可见;
2. **无生产/日常会话的常驻卡顿观测**——LoAF/longtask 只在 harness begin/end 窗口内采集,真实用户卡了没有任何记录;建议加一个常驻低开销 LoAF 采样(仅 blockingDuration>50ms 时记一条,并附 {scale, visibleIframes, mountedWebviews} 标签),本地环形缓冲即可,不必上报;
3. **门禁场景缺 iframe 重负载 + 全览态**——基线钉在 100 节点/0 webview/scale 1;应补 `--seed-webpages 40` + zoom-out-to-fit 场景,把本次发现锁进棘轮。

## 优化版本报告(2026-07-13 最终,优化前 `1272556` → 优化后 `47ac603`)

**测量方法**:`scripts/perf/renderer-bench/gestures.mjs`,无 trace 开销、每版 3 次独立运行取中位数(Xvfb 有头、同一 86 节点/40 iframe fixture)。基线 = 所有产品修复之前的 `1272556` src 构建;优化版 = 最终 HEAD `47ac603`(含 L2/L3 webview 生命周期——该两层只影响 url-webview 路径,台架不可测,复测确认对可测路径零回归:`158e58a` 与 `47ac603` 两轮中位数在噪声范围内一致)。绝对值受软件渲染影响,**中位数相对差是结论依据**。

### 本版包含的修复

1. **全览语义缩放**(`54cfc25`):settled scale < 0.35 时 live iframe 切静态占位(`display:none` 保状态),覆盖 iframe 与 dynamic-app 两类节点。
2. **内联 iframe 懒挂载**(`158e58a`):html/srcdoc/artifact iframe 复用 url-webview 的可见性延迟挂载;观察目标是 pending 占位元素,全览态不会批量挂载隐藏子文档;rearm key 处理 url/流式条件渲染。
3. **scrollback 自动保存去 undo 化**(`158e58a`):终端/agent 每 2s 的 scrollback+cwd 持久化改走 `updateNode(..., {history:false})`,不再占用撤销槽(带回归测试);全画布数组替换与防抖落盘保留(结构性改造另行立项)。
4. **常驻卡顿观测**(`158e58a`):`perf/jank-monitor.ts` 全程记录 blocking≥50ms 的 LoAF 到 `window.__pulseJank` 环形缓冲,每条带 `{scale, visibleEmbeds, canvasNodes}` 负载标签——本轮实测已验证可用(样本正确标注 scale 0.1 / 86 节点)。

**试过并按测量结果回滚的**(记录在 `useCanvas.ts` 阈值注释):手势中途翻转 overview 类(把 40 iframe 的显示切换抖动搬进手势窗口,zoom 16%→20.6% 帧超);拖拽节点临时 `will-change` 提层(Layerize 反而恶化)。

**webview 休眠(Chrome 式生命周期,L2+L3 已实现)**:参照 Chrome 后台标签页的 throttled → frozen → discarded 阶梯,全链落地。实时协作白名单中的页面仅保留 L1 1fps 降帧、跳过 L2 冻结和 L3 丢弃；当前首批包括飞书/Lark、Google Docs、Microsoft 365/SharePoint、Notion、腾讯文档、金山文档、Figma/FigJam、Miro 和 Canva。匹配的是 guest 当前 URL，离开这些站点后会在低频重试中重新进入生命周期阶梯。
- **L2 冻结**:离屏 5 分钟后经 CDP `Page.setWebLifecycleState('frozen')` 挂起页面任务队列(JS/定时器/网络全停、内存保留、**唤醒零重载**,页面收到标准 `freeze`/`resume` 事件),豁免与 Chrome 一致(audible / DevTools 打开不冻,被拒后 60s 重试);回视口先 resume 再恢复帧率,debugger 管道仅冻结期间持有。实现:`main/webview/lifecycle.ts`(控制器,7 个单测)+ `iframe:set-lifecycle` IPC + `useWebviewBackgroundThrottle` 冻结档。
- **L3 丢弃(Memory Saver 式)**:主进程每 30s 用 `app.getAppMetrics()` 汇总 guest RSS,超预算(默认 1.5GB,`PULSE_CANVAS_WEBVIEW_MEMORY_BUDGET_MB` 可调)时**只从已冻结页面里**按最久冻结优先选取(纯策略 `discard-policy.ts`,4 个单测:活跃页永不丢、达预算即停),`capturePage` 抓末帧截图(限宽 800px,失败回退卡片)→ 广播 `iframe:discarded` → 渲染端卸载 `<webview>`(guest 进程释放)显示"休眠中"占位;**驻留视口 2s 或点击唤醒**(重建重载,同 Memory Saver 的 activate-to-restore 契约;dwell 门槛防平移扫过触发重载风暴)。实现:`main/webview/discard-monitor.ts` + `useWebviewDiscard.ts` + 占位 UI。
- **Right Dock 补齐(2026-07-22)**:真机能耗排查发现生命周期原先只覆盖 Canvas iframe 节点;Right Dock 的已访问 link tab 虽由父 pane 设为 `visibility:hidden`,仍保留完整视口尺寸,5 个挂载 guest 中 4 个处于该形态,隐藏页 JS/timer/网络继续运行且单个 guest 突发达到约 20% CPU。`LinkDrawer/useDockWebviewLifecycle.ts` 现在以 dock active/split 状态(而非不可靠的 IntersectionObserver)驱动同一阶梯:失活立即 1fps、30 分钟冻结、超预算接受 L3 丢弃、再次激活按 freeze-time URL/scroll 恢复;audible/DevTools 豁免与 Canvas 节点一致。Dock 是通用业务页面入口,冻结宽限期刻意长于 Canvas 离屏节点的 5 分钟,降低上传、协作和长任务被暂停的风险。回归测试:`LinkDrawer/__tests__/webview-lifecycle.test.tsx` + `RightDock/__tests__/DockPanes.test.tsx`。
- **沙箱内已验证**(Chromium CDP 探针 + 台架真实组件,2026-07-13):
  1. Chromium **顶层页面**探针:`Page.setWebLifecycleState('frozen')` 对可见页面静默空转(命令成功返回但 JS/网络照跑)——`SetPageFrozen` 要求 WebContents 处于 hidden。**截图前移到冻结瞬间**(冻结+隐藏后 paint 停止,丢弃时抓图会空白),存 `freezeSnapshots`,L3 优先消费。
  2. 恢复路径零重载(`loadedAt` 不变)、命令幂等无副作用——CDP 探针确认。
  3. **L3 渲染端全流程真实组件验证 PASS**:`iframe:discarded` → 截图占位出现 + webview 卸载;视口驻留 2s → 自动唤醒、webview 重建,零报错。
- **真机(CI 真实 Electron)已验证**(perf.yml `large-canvas` job 里的 `scripts/perf/webview-lifecycle-check.mjs`,双隔离会话,run #114 全绿,2026-07-13):
  - **冻结/恢复腿(7 步)**:guest 注册可寻址 → 基线 ping 流动(300ms 心跳)→ 冻结后 **5s 内 0 ping(JS+网络全停)** → resume 后 **251ms 首个 ping 恢复** → **页面载入戳不变(零重载)**。
  - **L3 丢弃腿(1MB 预算)**:冻结后 30s sweep 内丢弃成立——休眠占位出现、`<webview>` 元素移除、guest 静默。
  - **Electron 专属发现 ①(run #112,修正沙箱结论的外推)**:webview 元素 `visibility:hidden` **不会**使 guest `document.visibilityState` 转 hidden——guest 的文档可见性跟随宿主窗口而非元素 CSS。"隐藏元素使冻结生效"的前提在 Electron guest 上不存在,据此把冻结改为**双层机制**(`main/webview/lifecycle.ts`):`Page.setWebLifecycleState('frozen')` + `Emulation.setScriptExecutionDisabled(true)`(同一根 debugger 管道;脚本禁用与可见性无关,禁用期定时器/handler 跳过执行、恢复后继续,DOM/JS 状态零丢失)。元素隐藏保留,角色降级为"冻结页同时停止合成/绘制"。
  - **Electron 专属发现 ②(run #114 探针 freeze 事件计数)**:尽管 guest 自报 visible,`Page.setWebLifecycleState('frozen')` 在 guest 上**实际生效**——探针页收到 1 次标准 `freeze` 生命周期事件(guest WebContents 的浏览器侧可见性与文档自报状态不一致)。含义:页面能收到标准 freeze/resume 事件(WebSocket 按 Chrome 后台标签语义断开/重连),脚本禁用层是保险而非唯一机制。
  - **Electron 专属发现 ③(run #113,检查暴露的新 bug,已修)**:对已隐藏 guest 的 `capturePage` **永不 resolve**(无帧可拷贝)——曾把整个冻结 IPC 挂死 15s+;丢弃 sweep 的实时抓图回退有同样隐患(触发即把 `sweeping` 重入闩永久锁死)。修复:`main/webview/snapshot.ts` 统一 2s 超时有界抓图,超时/失败回退卡片占位,带"永不 settle 的 capture"回归单测。
- **仍需真机人工验证**(CI 无法覆盖的观感/环境项):真实外部 SPA 的 WebSocket 重连表现;冻结后 guest CPU 归零的 `app.getAppMetrics()` 数值;真实 1.5GB 预算下的丢弃节奏与唤醒观感;DevTools 豁免的交互路径。

### 优化前后对比(中位数 × 3)

| 指标 | 优化前(`1272556`) | 优化后(`47ac603`) | 变化 |
|---|---|---|---|
| 挂载到 86 节点可交互 | 648ms | 478ms | **-26%** |
| 挂载即创建的 iframe 子文档 | 40 个 | 0 个(视口内随后按需创建;整轮交互后累计仅 24/40) | **-100% 首挂载** |
| 挂载期长任务合计 | 402ms(max 219) | 283ms(max ~110) | **-30%,最大阻塞减半** |
| 稳态 idle 10s 帧超 | 0.2% | 0.5% | 持平(噪声级) |
| scale-1 拖拽帧超 | 4.0% | 5.0% | 持平(噪声级) |
| **缩小到全览手势** | **94.7% 帧超,手势拖长到 10.4s,长任务 7.1s** | **34.1%,3.8s** | **帧超 -64%,手势快 2.7 倍** |
| **全览态拖拽** | **95.1% 帧超,长任务 2.6s,帧 p95 117-150ms** | **44.6%,长任务 ~0.2s,帧 p95 50ms** | **帧超 -53%,长任务 -93%,无大卡段** |
| 全览态可见 live iframe | 40 | 0(全部占位) | 语义缩放生效 |
| url webview 后台行为 | 1fps 降帧,JS/网络永远全速,进程只增不减 | 5min 冻结(JS/网络归零,251ms 零重载唤醒)+ 超预算 LRU 丢弃(进程/内存回收,占位+唤醒) | **CI 真实 Electron 双腿验证通过**(run #114) |

**残余优化(2026-07-13 追加,已落地)**:全览拖拽的连续小慢帧被 trace 归因到 **compositor Layerize 占主线程忙时 75%**(1826ms/2427ms,146 次、峰值 44ms——逐帧 PaintArtifactCompositor 全量 update,成本随全文档 paint chunk 规模走)。对照实验二分(V0 整节点不绘制 → V2 只留卡片外壳 → V3 隐藏整个 header → V4 只隐藏动作浮层)把元凶钉到一处:`--small` 档(scale<0.6)下每个节点 `opacity:0` 待命的浮动动作组(`.node-header__actions`),自带 **backdrop-filter + 反缩放 transform + opacity 三重属性树节点 ×86**——视觉透明,但对合成器全量存在。修复两条 CSS(`CanvasNodeView/index.css`):① 非 hover/选中时动作浮层 `display:none`(hover/选中行为不变,仅损失 0.18s 淡入;卡片外壳、标题、favicon 全保留);② 全览下重 body(file/terminal/agent/mindmap/reference/plugin)`visibility:hidden`(保布局防 xterm 0×0;image/shape/text 缩略保留)。实测(同环境中位数×3):全览拖拽帧超 34.7%→**1%**(p95 33.4→16.8ms 恢复单 vsync,手势窗口快 49%),缩小到全览 36.5%→**21.3%**(手势快 46%),Layerize 1826→207ms,idle/scale-1 拖拽/挂载零回归。

**zoom 手势中段(scale 0.35-1)——以真机数据关闭(2026-07-14)**:台架的 21.3% zoomOut 残余帧超是用**同进程 iframe 代演 webview**的失真。新增诊断探针 `scripts/perf/zoom-gesture-probe.mjs`(large-canvas job 第三腿,不设门禁):专用工作区 5×5 网格(12 真 url webview + 12 内联动画 iframe,中心留空给滚轮),校准到 scale≈1、预热穿越阈值一次后测四个窗口。真机(真实 Electron,24 embed 全活跃)结果:深缩出 0.904→0.1 帧超 **5.1%**(零长任务)、overview settle 交换 **0%**、深缩回 2.2%、交换回 settle **0%**——真 webview 是跨进程 OOPIF 表面,手势中在合成器上缩放、不在宿主重栅格,成本只有台架代演的约 1/4。**"手势期给 live iframe 盖静态化层"候选据此不做**(CI 亦为软件渲染,绝对值仍偏悲观;结构性问题已回答)。探针迭代中还钉下三个 harness 事实:CDP `Input.dispatchMouseEvent` 合成的 ctrl+wheel 在 Electron 上到不了页面 zoom handler(探针改用 JS `WheelEvent{ctrlKey}`,渲染管线路径相同);后台 workspace 保持挂载、`.canvas-transform` 有多个,选可见者(`offsetParent !== null`);探针 HTTP server 在 guest 被杀时可能被半开连接吊住,verdict 后须显式 `process.exit(0)`。

**后续**:`--seed-webpages>0` 档位已以 CI `large-canvas` job 落地(90 节点/40 网页 perf:report + webview 生命周期行为检查 + 深 zoom 探针,`performance` label 或手动 dispatch 触发),规模曲线(D6)与计时基线仍待真机;webview 休眠(L2 冻结 + L3 丢弃)已实现并经 CI 真实 Electron 行为验证,余下为观感/环境项(见上节清单)。

### 冷启动 webview 初次加载调度(2026-07-22)

真机 clone 排查确认可视 URL 节点的 `did-start-loading` 可在同一 3ms 内全部触发,原有 `useDeferredVisibleMount` 只把 guest 创建移出首帧,没有全局并发上限。新增 renderer-wide `InitialWebviewLoadScheduler`:默认同时放行 2 个**初次导航**,RightDock active/split 优先,Canvas 节点按距视口中心排序;仅在完成、主 frame 失败或卸载时释放名额(生产不以墙钟超时释放,避免 20–30s 的真实 Lark guest 仍在加载却让账面并发失真),已挂载页面的后续导航/刷新不受调度。若两个后台槽均被慢页占满,允许最多 1 个 active Dock 前台请求越过队列,避免用户主动操作无限等待。排队节点显示标题/favicon 占位,不再是白板。`PULSE_CANVAS_PERF=1 PULSE_CANVAS_WEBVIEW_CONCURRENCY=0|2` 提供隔离 A/B,生产默认固定为 2。

真实 Electron 确定性场景`scripts/perf/webview-load-check.mjs`在一次性 HOME 中挂 6 个独立 guest,每页固定 350ms 启动工作。全新 profile A/B:无限制峰值 6、首个/全部完成 406/427ms;并发 2 峰值严格为 2、首个/全部完成 398/1183ms,排队峰值 4 个占位,6 个均以 `complete` 释放。结论:短任务下首个完成时间未回归,代价是后台页面分批完成;该 fixture 只证明 admission/释放/占位机制,不能单独证明指定业务页面总是最先 ready。真实 Lark 的网络、鉴权、SPA hydration,以及加载中切换 active Dock 的端到端时延仍需有登录态页面实测。完整命令:`pnpm --filter canvas-workspace perf:webview-load:ab`。

PR #838 的 Linux CI 暴露出 scheduler 随静态 `IframeNodeBody` 进入启动 chunk 后,入口 gzip 192KB 超过 191KB Gate。修复把整个 iframe body 放进 `DefaultCanvasNode` 既有的 React.lazy/Suspense 体系,并以 `bundle-boundaries.test.ts` 锁住动态边界;同口径本地 analyze build 降到 raw 604KB、gzip 175KB、startup CSS 101KB(修复前 CI 分别约 662/192/114KB),无需放宽基线。真实 Electron A/B 仍为并发峰值 6→2、首个完成 426→396ms、4 个排队占位,说明 chunk 延迟没有破坏调度与可见反馈。

## 合并另一实现的高价值项(2026-07-14,codex 移植批次)

另有一版平行实现(`codex/canvas-webview-performance`)针对同一批主题做了系统优化。经代码级评估后,把其中**与本分支正交、或能补齐本分支留白**的四个子系统以 dynamic 多 agent 编排移植进来(每组"移植→对抗式评审→修复"流水线,四组评审全部 APPROVE、零必修),并适配到本分支已有的生命周期阶梯。CI 完整批次(`0e2537ee`)全绿:perf 17/17、large-canvas 三腿(报告 + 冻结/丢弃 + 深 zoom 探针)、macOS 打包。

- **丢弃安全捕获 + URL/滚动恢复**(`a209bed1`,`main/webview/freeze-probe.ts` 新增):不照抄源分支的"丢弃时解冻探测",而是利用本分支**冻结优先**性质(页面冻结=脚本禁用后不可能再产生脏状态)——在冻结瞬间一次性有界(≤1500ms,fail-closed)捕获 `{scrollX, scrollY, dirty, reloadable, url}`。L3 sweep 跳过 dirty/不可重载/无记录候选(fail-closed,但其 RSS 仍计入预算投影,让别的干净页被丢),丢弃广播携带 `restoreUrl/scrollX/scrollY`,渲染端在重挂 webview 的 `dom-ready` 后恢复滚动。补齐了原文档"真实预算下丢弃观感"里"恢复不带滚动/URL"的缺口。
- **registry 世代守卫**(同上):`register` 挂 `wc.once('destroyed')` 自动注销、`unregister` 改为按 `webContentsId` compare-and-delete(旧 renderer 的延迟注销不能误删新世代)、`iframe:unregister-webview` IPC 要求 `webContentsId`、`getWebContentsForNode` 自愈已销毁项。IPC 契约保持 135=135。
- **终端脏标记持久化 + PTY lease**(`5fd8a4a9`):2s 心跳的**全量 buffer 扫描本身**被消灭——`markDirty` 在 xterm write 回调里打标,版本计数器 flush 在 clean 时早返回(idle 零扫描零落盘);会话交接防前任延迟清理覆盖后继;PTY session lease 防旧组件卸载误杀新终端。**保住本分支的 `updateNode(..., {history:false})` 撤销槽修复**(回归测试仍绿)。补齐原文档"方向映射 #3 scrollback 专用 patch 路径"的坑。
- **边拖拽预览态**(`d6d04220`):mousemove 只更新渲染态 `previewPatch`,mouseup 单次 `updateEdge`(一步撤销),Escape 零补偿写;rAF 合并 + mouseup 同步 flush。与本分支工作完全正交的纯增益。
- **移除手势层提升 + shield 三态**(`0e2537ee`):删掉 `.canvas-transform--moving { will-change: transform }`——首个滚轮事件的整树提层同步栅格整个画布,且**会让 Chromium 丢弃并重载 webview guest**(这很可能是平行实现 ">15s 首帧" 的真根因);shield 拆成 direct/iframe/motion 三态,平移滚轮走更便宜的画布态 shield、不再给每个 iframe 建伪 shield。

**will-change 移除的诚实权衡**(深 zoom 探针,真 webview,移除前 `e5312c4` → 移除后 `0e2537e`):深缩出 **p95 最差帧 66.7ms → 33.4ms(大停顿消失)**,但 20-33ms 小帧占比 5.1% → 11.9%,长任务两者皆 0,三个 settle 窗口皆 0%。即"最差情况更平滑、小帧略多"——与理论一致(去掉提层消除了首事件同步栅格大停顿,代价是持续 transform 期小重绘变多)。同进程台架(中位数×3,更稳)则显示 zoomOut 帧超 21.3% → 17.5% 净改善。主要收益(避免 guest 重载)探针未单独隔离测量。**决定保留**:门禁全过、settle 全 0%、p95 减半;但"更少大卡顿 vs 更多小帧"的取舍**待重 webview 真机 A/B 终审**,列为观感待确认项。

## 核查方法

三个并行只读核查(iframe/webview 生命周期、交互渲染管线、终端输出/归档/基准设施),每条结论要求 file:line 证据并区分已修/未修;与 consolidated/round3 编号对齐,已修项(E1、B7、B9/V2、F1/F2、chat 批处理、图片缩略图、LRU 驱逐、bundle lazy 等)复核确认在位后不再列为问题。运行时实测经 `scripts/perf/renderer-bench/`(见上节),bundle 侧经 `perf:report --bundle-only`。
