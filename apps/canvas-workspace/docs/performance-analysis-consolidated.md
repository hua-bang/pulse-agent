# Canvas Workspace 性能分析总报告(两轮整合)

> 本文档整合两轮 dynamic-workflow 深度分析的全部**经对抗式验证**的发现,去重后按统一维度编号并给出合并路线图。
> - **第一轮**(`docs/performance-analysis.md`):9 维通用性能扫描,52 条原始 → **39 条确认**。聚焦"渲染扇出 / 状态集中 / 主进程同步 I/O"。
> - **第二轮**(`docs/performance-analysis-round2.md`):前端资源 / 首屏渲染 / 运行时 三维,锚定真实导入图,61 条原始 → **30 条确认且全新**(已剔除 13 条与第一轮重复)。
> 详细证据(逐条代码引用、对抗性校正)见上述两份原始报告;本总报告为权威索引 + 执行层 + 统一路线图。
> - **第三轮**(`docs/performance-analysis-round3.md`):盲区补集扫描(输入热路径 / main 非终端域 / 媒体 CSS / 生命周期 / 增量回归),21 原始 → **20 条确认且全新**;其 I-1/J-1/J-2/K-1 建议升入 P1。E1、B3、F1/F2、A6 已由 commit `1c282e3` 修复。
> **重要前提**:本仓为 Electron 桌面应用,renderer 从本地 `file://` 加载,**无网络下载成本**——所有"体积"类发现的真实代价是**主线程 parse/eval 时间**。依赖未安装,**全部体积/耗时数字均为估算**,需按文末「实测验证计划」用 profiling 替换。

---

## 执行摘要

Canvas Workspace 的性能问题可归纳为 **5 个系统性根因**,贯穿两轮全部发现:

1. **集中式 `nodes` 数组是最大结构放大器** —— move/resize/scrollback/cwd 自动保存全走同一 `updateNode → setNodes` 路径,任何变更替换整个数组 identity,引爆下游全量重算(A、B 维多条)。
2. **缺失虚拟化(视口裁剪)** —— Canvas 与 GraphPage 都按**全集**而非**屏幕集**挂载/渲染重型 DOM(xterm/Tiptap/iframe),内存与挂载成本随**节点总数**线性增长(A 维)。
3. **主进程 IPC 串行化使任何同步/重复 I/O 成为全应用停顿** —— `getCwd` 的 `execSync(lsof)`、`canvas:save` 的 ~5N 次读、`execInSession` 的 O(n²) 扫描全跑在服务所有 IPC 的同一事件循环(B、E 维)。
4. **零代码分割 / 首屏关键路径过载** —— 全仓 **0 个 `React.lazy`**,8 种节点 body + Tiptap全家桶 + lowlight common + xterm + markdown-it 全折叠进启动 chunk;主进程 4 步串行 await 后才开窗,且默认画布在首屏挂一个**外部 URL 的 live `<webview>`**(C、D 维)。
5. **流式热路径与稳态后台缺乏帧级合并与挂起** —— chat token / PTY chunk / tool delta 以远超显示需求的频率 setState;offscreen webview 只降帧不停 JS/timer;force-graph toggle 触发 12s 主线程物理(F、G、H 维)。

**整体健康度:中等偏下** —— 无崩溃或正确性致命缺陷,但在"多终端 / 多 Agent / 多 workspace keep-alive / 大画布 / 含 chat 与 graph"的目标负载下,内存与主线程会出现明显的可扩展性天花板。

---

## 严重程度概览(两轮合并,去重后)

| 维度 | critical | high | medium | low | 小计 |
|---|---|---|---|---|---|
| A. 渲染与重渲染扇出 | 0 | 2 | 4 | 3 | 9 |
| B. 状态管理与持久化 | 0 | 2 | 5 | 1 | 8 |
| C. 前端资源与代码分割 | 0 | 0 | 6 | 3 | 9 |
| D. 首屏渲染与启动 | 0 | 1 | 2 | 5 | 8 |
| E. 终端 / Agent / PTY / IPC | 0 | 2 | 4 | 4 | 10 |
| F. 聊天流式与 Markdown / Mermaid | 0 | 1 | 5 | 2 | 8 |
| G. Force-graph / 工作区图 | 0 | 1 | 5 | 2 | 8 |
| H. 运行时盲区:webview / 图片 / keep-alive | 0 | 1 | 3 | 3 | 7 |
| **合计** | **0** | **10** | **34** | **23** | **67** |

> 计数为两轮去重后的近似归并(部分发现跨维度,如"无视口裁剪"同时属 A 与 D);严重度以对抗性校正后的值为准。`[R1-xx]` 指第一轮编号,`[R2-§x]` 指第二轮编号。

---

## 维度 A:渲染与重渲染扇出

| ID | 严重度 | 标题 | 关键文件 |
|---|---|---|---|
| A1 `[R1-H1]` | high | Canvas 无视口裁剪,每个可见节点挂载完整实时 DOM 子树(xterm/Tiptap/iframe) | `Canvas/hooks/useCanvasVisibility.ts:40` |
| A2 `[R1-H2]` | high | drag/resize 每 pointer-move 替换整个 nodes 数组,重跑 visibility+sort+split 流水线 | `hooks/useNodes.ts:586` / `CanvasSurface.tsx:121` |
| A3 `[R1-M1]` | medium | `containerDescendantCount` 每次 group/frame 渲染重算 O(n×containers) 父图 | `useCanvasNodeViewModel.ts:245` |
| A4 `[R1-M2]` | medium | `CanvasSurface.renderNode` 内联非 memo 闭包,逐节点传 ~31 props,每 pan 帧重建 | `CanvasSurface.tsx:174` |
| A5 `[R1-M3]` | medium | scrollback 自动保存污染 undo 栈(Ctrl+Z 回放终端文本)+ 强制全数组拷贝 | `useNodes.ts:454` / `useNodeHistory.ts:28` |
| A6 `[R1-L1]` | low | `resizeGroupsToChildren` 无 group 时也跑全 Map+map,无早退 | `useNodes.ts:399` |
| A7 `[R1-L2]` | low | 逐节点 30s `setInterval` 相对时间 tick,`node.updatedAt` 改即重建定时器 | `useCanvasNodeViewModel.ts:81` |
| A8 `[R1-L3]` | low | `CanvasGestureHud` 收完整 nodes 数组,每 resize tick O(n) `.find` | `CanvasSurface.tsx:275` |
| A9 `[R2-§3.8]` | medium | `renderNode`(graph)rAF 活跃时每节点每帧 `ctx.save+measureText+roundRect+fillText` | `GraphPage.tsx:481` |

**A 维核心修复**:把实时 drag/resize 几何排除出正式 `nodes` 数组(手势中 CSS overlay / position override map,pointer-up 提交);引入 `useViewportCulling`(transform+容器尺寸入参,离屏节点渲染占位、进 margin band 才懒挂载重型 body);`CanvasSurface` 包 `React.memo`,父层 memo 化父容器图与 render-order。

---

## 维度 B:状态管理与持久化

| ID | 严重度 | 标题 | 关键文件 |
|---|---|---|---|
| B1 `[R1-H5]` | high | 完整 xterm scrollback 每 2s 遍历 join 成串,触发全 nodes 替换 + 防抖磁盘写 | `AgentNodeBody/utils/terminal.ts:34` |
| B2 `[R1-H6]` | high | `canvas:save` 把读-合并-写跑两遍,为 1 个改动节点做 ~5N 次磁盘读 | `main/canvas/store.ts:1161` |
| B3 `[R1-M-Save1]` | medium | `writeCanvasFullV2` 每次保存 read+write 每个 per-node 文件,即便未改动 | `main/canvas/storage.ts:886` |
| B4 `[R1-M-Save2]` | medium | 终端 scrollback 自动保存(每终端每 2s)驱动全 canvas 序列化 | `TerminalNodeBody/index.tsx:234` |
| B5 `[R1-M-Save3]` | medium | 隐藏终端节点的 2s scrollback+getCwd 自动保存 `display:none` 时不暂停 | `TerminalNodeBody/index.tsx:234` |
| B6 `[R1-M-Keep1]` | medium | 每个挂载(隐藏)Canvas 保持 `canvas:external-update` 订阅,匹配 workspace 全盘重读重建 | `useNodes.ts:154` |
| B7 `[R2-§1.5]` | medium | AI/HTML iframe 节点把完整生成 HTML 内联进 per-node 画布 state,每次保存来回序列化 | `IframeNodeBody/useIframeNodeState.ts:301` |
| B8 `[R1-M-Keep2]` | low→med | 共享 `allNodes` map 每 2s churn,经不稳定 `resolveReference` 回调重渲染所有挂载 Canvas | `Workbench/useWorkbenchState.ts:98` |

**B 维核心修复**:分层 state —— scrollback/cwd 等"非视觉数据"走专用 patch 路径(不 push undo、不 resize group、不全 canvas 序列化);`canvas:save` 单次 merge + 缓存 `readCanvasFull` + 只写 `updatedAt` 变化的节点;HTML 内联改 sidecar 文件 + ref;隐藏/非 active 时暂停定时器与订阅。

---

## 维度 C:前端资源与代码分割

> 公共背景:`electron.vite.config.ts` renderer 段**无 `manualChunks`、无 `build.target`**;全仓 `React.lazy` 边界 **= 0**;唯一运行时 `import()` 代码分割点是 `chat/utils/mermaid.ts`。以下静态 import 全部折叠进同一启动 chunk。

| ID | 严重度 | 标题 | 关键文件 |
|---|---|---|---|
| C1 `[R2-§1.1]` | medium | 全部 8 种节点 body 的依赖联合体静态拉进首屏 chunk(空画布也付) | `CanvasNodeView/DefaultCanvasNode.tsx:12` |
| C2 `[R2-§1.2]` | medium | xterm `Terminal` 被 5 个文件静态 import——与已做对的 mermaid lazy 正相反 | `TerminalNodeBody/index.tsx:3` |
| C3 `[R2-§1.3]` | medium | chat 面板首屏无条件挂载,经 mentions 再导出把 markdown-it + hljs/lib/common 拉进启动 chunk | `chat/utils/markdown.ts:1` |
| C4 `[R2-§1.4]` | medium | `createLowlight(common)` 模块顶层把完整 hljs common(~35 语法)拉进首屏 | `hooks/useFileNodeEditor.ts:36` |
| C5 `[R1-B1]` | medium | 无 `manualChunks`——整个 renderer 打成单个 eager-parse chunk | `electron.vite.config.ts:111` |
| C6 `[R1-B2]` | medium | `DefaultCanvasNode` 静态 import xterm + tiptap 节点体进 keep-alive canvas chunk | `DefaultCanvasNode.tsx:12` |
| C7 `[R2-§2.7]` | low | `main.tsx` 静态 import module-federation runtime 并在首渲染前触发联邦加载 | `main.tsx:7` / `plugins/renderer/federation.ts:1` |
| C8 `[R2-§2.8]` | low | I18nProvider 首渲染 eager import 含 en+zh 双表的 2377 行 messages 模块 | `i18n/messages.ts` |
| C9 `[R1-L8]` | low | 实验视图(GraphPage / force-graph / d3)在 flag 关闭时仍被 `App.tsx` 静态导入 | `App.tsx:14` |

**C 维核心修复**(P1 主杠杆):引入**全仓第一个 `React.lazy` 边界** —— `DefaultCanvasNode` 的 8 个 body 全部 `React.lazy + Suspense`(占位框作 fallback);xterm/markdown 套用 mermaid.ts 的 `import()` memoize 模板;`createLowlight(common)` 换 curated 子集(~5-8 语言);`electron.vite.config.ts` 加 `manualChunks` 拆 xterm/tiptap/lowlight/force-graph/MF-runtime 为独立 async chunk;i18n 按语言拆分(en eager / zh lazy)。

---

## 维度 D:首屏渲染与启动

| ID | 严重度 | 标题 | 关键文件 |
|---|---|---|---|
| D1 `[R2-§2.1]` | **high** | 默认首启画布在首屏关键路径挂指向外部 URL 的 live `<webview>`(guest 进程 + 网络导航) | `main/canvas/welcome-workspace.ts:205` / `IframeNodeBody/useIframeNodeState.ts:101` |
| D2 `[R2-§2.2]` | medium | 窗口加载串行卡在 4 步 async 链(seeding+env+内建插件+外部插件)后才 `openWindow()` | `main/app/bootstrap.ts:106-191` |
| D3 `[R2-§2.3]` | medium | 重 body 模块静态 import 进 DefaultCanvasNode 落入启动 chunk(0 lazy 边界) | `DefaultCanvasNode.tsx:12`(同 C1/C6) |
| D4 `[R2-§2.4]` | medium | 首绘同步构造两个 Tiptap 编辑器,各 eager 注册全 common 语言 | `hooks/useFileNodeEditor.ts:16` |
| D5 `[R2-§2.5]` | low | 插件激活 gating 论据(注释)强于首绘所需;agent service 已更早构造 | `main/app/bootstrap.ts:159` |
| D6 `[R2-§2.6]` | low | `reloadConfiguredExternalMainPlugins` 在窗口打开前同步 await 每个外部插件 `import()` | `plugins/main/external.ts` |
| D7 `[R2-§2.9]` | low | 首启 welcome seeding 在窗口打开前完整执行 mkdir + 2×writeFile + saveCanvas + manifest | `main/canvas/welcome-workspace.ts:270` |
| D8 `[R1-B3]` | low→med | 窗口仅在 await 插件 setup + tools-config + welcome seeding 后才打开 | `main/app/bootstrap.ts:106`(同 D2) |

**D 维核心修复**(P0):welcome 的外部 `<webview>` 延迟到首屏后/进视口后挂载(占位卡片 + IntersectionObserver/idle);重排 `bootstrap.ts` —— 先 `openWindow()`/`loadFile`,seeding+插件激活并发于 renderer 下载/绘制(以 `mainReady` promise 保序;插件工具注册延迟到首个 agent turn 前而非窗口前)。

---

## 维度 E:终端 / Agent / PTY / IPC

| ID | 严重度 | 标题 | 关键文件 |
|---|---|---|---|
| E1 `[R1-H3]` | high | `getCwd` 自动保存每 2s 对每节点同步 `execSync(lsof/readlink)`,阻塞主进程事件循环 | `main/terminal/pty-manager.ts:206` |
| E2 `[R1-H4]` | high | 每个 xterm 容器 ResizeObserver 在每缩放动画帧重 fit + 重同步字号 | `TerminalNodeBody/index.tsx:281` |
| E3 `[R1-M-IPC]` | medium | PTY `onData` 逐 chunk 扇出到渲染端 IPC + 每个 observer,零批处理 | `main/terminal/pty-manager.ts:281` |
| E4 `[R1-M4]` | medium | 团队 Agent 输出逐 chunk 经序列化队列 + 每会话锁 + 全量 ANSI strip 解析 | `main/agent-teams/pty-bridge.ts:52` |
| E5 `[R1-M-Exec]` | medium | `execInSession` 累积无界 buffer,对增长串每 chunk `includes/indexOf`(O(n²)) | `main/terminal/pty-manager.ts:406` |
| E6 `[R1-M-Mirror]` | medium | Mirror 终端 detached/离屏仍保活 `pty:data` 订阅并 `term.write`(unmount 未退订) | `useAgentNodeController.ts:415` |
| E7 `[R2-§3.9]` | low | `execInSession` 每调注册新 onData 监听器,无界缓冲直到 marker/30s,并发调用串扰 | `main/terminal/pty-manager.ts:406`(同 E5 角度) |
| E8 `[R2-§3.10]` | low | `pty:write`/`pty:resize` 无流控:大粘贴整块推送;拖拽 resize 每像素一次同步 IPC + 原生 resize | `main/terminal/pty-manager.ts` |
| E9 `[R1-L4]` | low | `scheduleTerminalFit` 每 mount/restore 触发 3 rAF + 2 setTimeout(5 次 fit+refresh) | `useAgentNodeController.ts:104` |
| E10 `[R1-L5]` | low | 渲染端 `onData` 在 coding-agent hint 激活时每 chunk 跑 ANSI-strip + 两正则 | `TerminalNodeBody/index.tsx:98` |

**E 维核心修复**(P0 含 E1):`getCwd` 改异步(linux 用 `fs.promises.readlink('/proc/<pid>/cwd')` 不 fork)并从 2s tick 解耦;PTY `onData` 合并 flush(~8-16ms/帧,一条拼接 IPC + 每 flush 一次 observer);`execInSession` 只扫尾部 marker + 数组 append + 封顶;mirror detach 时 `disposeSubscriptions()`;ResizeObserver rAF 合并 + 尺寸不变跳过 fit;`pty:resize` 拖拽去重。

---

## 维度 F:聊天流式与 Markdown / Mermaid

| ID | 严重度 | 标题 | 关键文件 |
|---|---|---|---|
| F1 `[R1-H7]` | high | `markdown.render` 为每个无语言提示代码块跑 `highlightAuto`,放大每 token 重解析(O(n²)) | `chat/utils/markdown.ts:18` |
| F2 `[R1-M-Chat1]` | medium | 逐 token `onTextDelta` 整 messages 数组拷贝;`ChatMessage` 未 memo,每 token 重解析 markdown | `chat/hooks/useChatStream.ts:240` / `ChatMessage.tsx:95` |
| F3 `[R1-M-Chat2]` | medium | `publishTools()` 每 tool-input delta 与每 `onVisualStream` 帧拷贝数组 + 克隆 Map | `chat/hooks/useChatStream.ts:142` |
| F4 `[R2-§3.4]` | medium | `mermaid.render()` 在 renderer 主线程同步无 worker,含图回复流式完成瞬间 jank | `chat/utils/mermaid.ts` |
| F5 `[R2-§3.5]` | medium | 首个图付多百 ms 的 `import('mermaid')` + initialize 主线程 stall | `chat/utils/mermaid.ts:15` |
| F6 `[R2-§1.6]` | low | mermaid 渲染每次 chat re-render 用 `host.innerHTML` 写裸 SVG,无 per-message 缓存 | `chat/utils/mermaid.ts` |
| F7 `[R2-§1.3]` | medium | chat 子树(markdown-it + hljs)首屏无条件加载(详见 C3) | `chat/utils/markdown.ts:1` |

**F 维核心修复**:`ChatMessage`/`ChatToolCalls` 包 `React.memo` + rAF 合并 text delta(每帧一次 setState);在途流式消息渲染纯文本/廉价 pass,完成时才跑完整 markdown+highlight,或按代码块内容 memo 化;mermaid 图间 yield + 限并发 + 源→SVG Map 缓存 + idle 预热 import。

---

## 维度 G:Force-graph / 工作区图

| ID | 严重度 | 标题 | 关键文件 |
|---|---|---|---|
| G1 `[R1-H8]` | high | `buildGraphData` 每次 toggle 产出新 graphData,layout effect 每次计数变化 reheat + zoomToFit | `GraphPage.tsx:337` |
| G2 `[R2-§3.2]` | medium | 可见性 toggle 重启全节点/链的 12s 主线程 d3 物理仿真(无 `cooldownTicks`) | `GraphPage.tsx:409` |
| G3 `[R2-§3.3]` | medium | 全局 `workspaceNodes` onChange 重载所有工作区节点,无关编辑也重热仿真 | `GraphPage.tsx` |
| G4 `[R1-M-Graph1]` | medium | `renderNode` 对选中/悬停节点逐帧 `measureText` + 带 shadowBlur 的 roundRect | `GraphPage.tsx:481`(同 A9) |
| G5 `[R1-M-Graph2]` | medium | `searchSuggestions` 每按键经 `tagName` 线性扫 O(nodes × tags) | `GraphPage.tsx:284` |
| G6 `[R2-§3.7]` | low | `linkDirectionalParticles` 击败 autoPauseRedraw,hover/active 钉死永久 60fps rAF | `GraphPage.tsx:767` |
| G7 `[R1-L6]` | low | `highlighted` 每悬停重算驱动 link 回调;`linkKey` 每 link 每帧建串 | `GraphPage.tsx:364` |
| G8 `[R1-L7]` | low | 全节点经 force-graph 渲染无上限/虚拟化,每 focus O(N) 线性 find | `GraphPage.tsx:337` |

**G 维核心修复**:node identity 复用以 warm-start(保留 x/y),仅 `layoutPreset`/结构变化才 reheat;设有界 `cooldownTicks`(100-200);`onChange` 加工作区过滤 + debounce + 拓扑 diff gate;`measureText` 按 (label,fontSize) 缓存 + zoom 阈值抑制 label;`tagName` 用 `Map`;移除/限 highlight particle。

---

## 维度 H:运行时盲区(webview / 图片 / keep-alive)

| ID | 严重度 | 标题 | 关键文件 |
|---|---|---|---|
| H1 `[R1-H9]` | high | `useMountedWorkspaceIds` 从不驱逐已访问 workspace + Canvas 无虚拟化(keep-alive 叠加) | `Workbench/useMountedWorkspaceIds.ts:11` |
| H2 `[R2-§3.1]` | medium | Background throttle 只降帧——offscreen webview 的 timer/fetch/WebSocket 永远全速 | `IframeNodeBody/useWebviewBackgroundThrottle.ts:84` |
| H3 `[R1-M-Keep3]` | medium | `PulseRouter` keepAlive 让整个 canvas 路由子树保持挂载,定时器/订阅/PTY 后台运行 | `router/index.tsx:56` |
| H4 `[R2-§3.6]` | low | iframe 类节点 body(DynamicApp/artifacts/AI-HTML 预览)无帧率限流——只有 url-mode webview 有 | `IframeNodeBody` |
| H5 `[R2-§1.7]` | low | 大图粘贴/拖入在主线程同步 decode+re-encode,落盘前来回 base64 | `utils/noteImageInsert.ts` |
| H6 `[R2-§1.8]` | low | `restoreLocalImageMarkdown` 每次内容加载用 TreeWalker 遍历整个编辑器 DOM | `editor`/note image |

**H 维核心修复**:LRU 限定挂载集(active + K=2-3),驱逐其余并拆 Canvas/ChatPanel/终端;非 active 路由/workspace 暂停定时器与 `external-update` 订阅(保留 DOM 状态);offscreen webview 超越降帧(宽限期后导航 about:blank / unmount);iframe 节点扩展 IntersectionObserver gating;大图 downscale 移 OffscreenCanvas/worker。

---

## 优先修复路线图(两轮合并)

### P0 — 解除线性恶化根因 + 首屏最重单项(高收益)

| 修复 | 对应 ID | 预估收益 | 改动量 |
|---|---|---|---|
| **视口裁剪 `useViewportCulling`** | A1, H1 | 内存/挂载从 O(总节点)降到 O(屏幕节点) | 大 |
| **`getCwd` 异步化 + 解耦 2s 自动保存** | E1 | 消除主进程每 2s fork N 子进程的同步阻塞 | 中 |
| **`canvas:save` 单次 merge + 增量写** | B2, B3 | 单节点改动 ~5N 读+N 写 → ~1 读+1 写 | 中 |
| **welcome 外部 `<webview>` 移出首屏关键路径** | D1 | 移除冷启最重单项(guest 进程 + 外部网络) | 小-中 |
| **`bootstrap.ts` 先开窗、后并发 setup** | D2, D5, D6, D8 | TTFP 减去插件激活串行链耗时 | 中 |

### P1 — 资源拆分 + 热路径合并(高/中收益)

| 修复 | 对应 ID | 预估收益 | 改动量 |
|---|---|---|---|
| **引入全仓首个 `React.lazy` 边界 + `manualChunks`** | C1-C6, D3, D4, C9 | 首屏 chunk 主线程 parse/eval 主杠杆 | 中 |
| **drag/resize 几何排除出 nodes 数组 + `CanvasSurface` memo** | A2, A3, A4, A6, A8 | 大画布拖拽 jank 消除 | 大 |
| **scrollback 专用低优先级更新路径** | B1, A5, B4, B5 | 消除 undo 污染 + 空闲全 buffer 遍历 | 中 |
| **Chat 流式:memo + rAF 合并 delta + 流式不跑 highlightAuto** | F1, F2, F3, F7 | 代码密集回复从 O(n²) → 完成时一次 | 中 |
| **PTY `onData` 合并 flush** | E3, E4, E8 | 高吞吐输出 IPC/CPU 压力降一量级 | 中 |
| **keep-alive 后台静默(LRU + 暂停定时器/订阅)** | H1, H3, B6, B8 | 多 workspace 内存停止单调增长 | 中-大 |
| **force-graph:有界 `cooldownTicks` + onChange 过滤/debounce + warm-start** | G1, G2, G3, G4, G5 | 实验 graph 大图帧率与搜索改善 | 中 |
| **mermaid:图间 yield + 限并发 + 缓存 + idle 预热** | F4, F5, F6 | 含图回复流末 burst jank 消除 | 中 |

### P2 — 局部清理与低频盲区收尾(小改动)

| 修复 | 对应 ID |
|---|---|
| `resizeGroupsToChildren` 无 group 早退 | A6 |
| 相对时间提升为单共享 ticker | A7 |
| ResizeObserver rAF 合并 + 尺寸不变跳过 fit | E2 |
| `execInSession` 只扫尾部 + 封顶 + per-session 串行 | E5, E7 |
| mirror detach 时 `disposeSubscriptions()` | E6 |
| `scheduleTerminalFit` 收敛单 rAF + trailing | E9 |
| coding-agent hint 提示符检测节流 | E10 |
| MF runtime 延迟出 entry chunk | C7 |
| i18n 按语言拆分 | C8 |
| welcome seeding 并发化 | D7 |
| AI/HTML iframe 改 sidecar 文件 + ref | B7 |
| offscreen webview 超越降帧 + iframe 节点 IntersectionObserver | H2, H4 |
| 大图 downscale 移 worker;TreeWalker 全文预检 | H5, H6 |
| 移除/限 highlight particle;`linkKey` 预算 | G6, G7, G8 |

---

## 架构级建议(跨发现的系统性模式)

1. **集中式 `nodes` 数组是最大结构放大器** —— 分层 state:几何/拖拽用 ephemeral override(ref/CSS),不入 canonical 数组;scrollback/cwd 等非视觉数据走专用 patch 路径(不 push undo、不 resize group、不全 canvas 序列化);canonical 数组只在结构性变更时替换。
2. **缺失虚拟化是内存与挂载成本天花板** —— Canvas 与 GraphPage 统一引入视口裁剪 + 离屏占位 + 懒挂载重型 body,与 keep-alive 多 workspace 叠加后收益倍增。
3. **主进程 IPC 串行化使任何同步/重复 I/O 都成全应用停顿** —— 原则:主进程零同步子进程(`fs.promises`/`execFile`)、增量而非全量(只写 diff、只扫尾部)、合并而非逐事件(per-id flush 窗口)。
4. **keep-alive 应保留状态但暂停工作** —— 引入 `routeActive`/`workspaceActive` 标志,隐藏时暂停定时器与订阅、保留 DOM/组件状态,LRU 驱逐真正空闲的 workspace;offscreen webview 也需超越降帧的挂起策略。
5. **流式热路径需要帧级合并与 memo 边界** —— chat token / tool delta / PTY chunk 统一:rAF/帧级合并 setState + 叶子组件 `React.memo` + 昂贵解析(markdown/highlight/ANSI/mermaid)缓存或延迟到静默。
6. **Bundle 应按"首绘不需即懒加载"切分** —— 沿用仓库已有的 `import('mermaid')` 模式,把 xterm/tiptap/force-graph/markdown/MF-runtime 全部 `React.lazy` + `manualChunks`,并把窗口创建移出主进程插件 setup 关键路径。

---

## 实测验证计划

> 依赖未安装,本报告所有体积/耗时为**估算**。安装后按下列采集真实数据替换估算,并据此重排优先级(哪条是真瓶颈需 profiling 才能定序)。

**A. Bundle / chunk 体积**(验证 C1-C9、D3/D4)
```bash
pnpm install
pnpm --filter canvas-workspace build
ls -lh apps/canvas-workspace/out/renderer/assets/*.js
```
加 `rollup-plugin-visualizer`(或 `source-map-explorer`)出 treemap,确认 lowlight common、Tiptap、xterm、markdown-it+hljs、MF-runtime、`messages.ts` 是否在 entry chunk。指标:startup chunk min/gzip 字节、各重依赖占比、lazy 化后缩减量。

**B. 首屏 / time-to-window**(验证 D1/D2/D5/D6/D7)
在 `bootstrap.ts` 的 `app.whenReady()` 起点与 `openWindow()` 处打 `performance.now()`,分段记录 seeding/applyEnv/setupCanvasPlugins/reloadExternal(分有/无外部插件两组);renderer `main.tsx` 首 `createRoot().render()` 前后打点;用 `webContents` `did-finish-load`/`dom-ready` 测 TTFP;welcome `<webview>` `did-finish-load` 计入 TTFMP 的耗时。

**C. React render / 节点 body 加载**(验证 A1/A4/D3/A9)
React DevTools Profiler 录冷启 + 打开各类型节点,统计 DefaultCanvasNode 及各 body 的 render count 与 commit 耗时;lazy 化后用 Network/Coverage 面板确认仅实例化类型的 chunk 被 fetch;Tiptap `useEditor` 构造次数与耗时。

**D. webview / PTY 进程与内存**(验证 D1/H2/E5/E8)
`app.getAppMetrics()` 采集 guest WebContents 进程数与各自 RSS;offscreen 节点用 Chrome Task Manager 观察 CPU% 是否随降帧下降(验证 H2:JS/timer 仍跑);终端拖拽 resize 计 `pty:resize` IPC 频次;execInSession 长跑命令观察 buffer 增长与监听器数。

**E. mermaid / force-graph 渲染耗时**(验证 G1/G2/G4/F4/F5)
`mermaid.ts` 的 `loadMermaid` 与 `render` 前后 `performance.now()`,实测首遇 import 耗时与每图 layout;含 3 图回复测流末 burst 总时长。force-graph 用 DevTools Performance 录 hover(particle rAF)/toggle(12s reheat)/跨工作区 onChange,测 per-frame `measureText` 调用数与帧时长、reheat 主线程占用秒数;对比有界 `cooldownTicks` 前后。

---

## 方法论说明

两轮均由 dynamic workflow 编排:动态侦察热点维度 → 每维度并发深度分析 → **每条发现派独立对抗式验证 agent 回真实代码逐条证伪**(默认 `isReal=false`)→ 综合。第二轮额外锚定真实导入图数据并判 `duplicateOfRound1` 去重。

- 第一轮:64 agent / 52 原始 → 39 确认(淘汰 25%)。
- 第二轮:78 agent / 61 原始 → 30 确认且全新(剔除 13 条重复 + 18 条证伪/低置信)。

对抗式验证多次**下修**了夸大结论(如把 Electron 本地加载误称"下载成本"、`React.memo` 已挡住的离屏重渲、React 18 自动批处理、welcome 空写守卫实际被跳过等),这些校正记录在两份原始报告的"对抗性核验"小节。

**最大残留盲区:全部 67 条均为静态代码推断,零 profiling**。需按上文「实测验证计划」跑一次 production build + React Profiler + Electron 进程指标,才能把估算换成真实数并最终定序。
