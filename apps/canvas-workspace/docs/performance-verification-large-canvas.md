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

## 核查方法

三个并行只读核查(iframe/webview 生命周期、交互渲染管线、终端输出/归档/基准设施),每条结论要求 file:line 证据并区分已修/未修;与 consolidated/round3 编号对齐,已修项(E1、B7、B9/V2、F1/F2、chat 批处理、图片缩略图、LRU 驱逐、bundle lazy 等)复核确认在位后不再列为问题。
