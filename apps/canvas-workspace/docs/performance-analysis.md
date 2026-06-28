# Canvas Workspace 性能深度分析报告

## 执行摘要

`apps/canvas-workspace` 的核心性能瓶颈集中在**三个系统性缺陷**:(1) Canvas 完全没有视口裁剪(viewport culling),所有非折叠节点无条件挂载完整的重型 DOM 子树(xterm/Tiptap/iframe),内存与挂载成本随**节点总数**而非**屏幕可见数**线性增长;(2) 节点/边状态高度集中,任何 drag/resize 的每个 rAF tick 都会替换整个 `nodes` 数组,触发完整的 visibility+sort+split 派生流水线;(3) 主进程在多处做同步/重复 I/O——`getCwd` 每 2 秒对每个终端跑同步 `execSync(lsof/readlink)`,`canvas:save` 对一个改动节点做 ~5N 次磁盘读,严重时序列化所有 IPC。整体健康度为**中等偏下**:无崩溃或正确性致命缺陷,但在"多终端 / 多 Agent / 多 workspace keep-alive"这一目标工作负载下,内存与主线程会出现明显的可扩展性天花板。最高优先级修复是**视口裁剪 + 主进程异步化 getCwd + 单节点增量保存**,这三项能解除绝大部分线性恶化。

## 严重程度概览

| 维度 | critical | high | medium | low |
|---|---|---|---|---|
| Canvas 节点 DOM 渲染与视口裁剪 | 0 | 1 | 2 | 0 |
| 集中式节点/边状态与变更时的重渲染扇出 | 0 | 1 | 2 | 2 |
| xterm/Tiptap 节点体生命周期、scrollback 序列化与自动保存 | 0 | 2 | 2 | 1 |
| PTY 输出经 IPC 流式传输 | 0 | 0 | 4 | 1 |
| Chat token 流式重渲染成本 | 0 | 1 | 3 | 0 |
| canvas:save 读-合并-写 与双 fs.watch 比对 | 0 | 1 | 2 | 0 |
| 多 Canvas / 多 Chat keep-alive 挂载 | 0 | 1 | 5 | 0 |
| Workspace graph (react-force-graph-2d) 渲染与数据重建 | 0 | 1 | 2 | 1 |
| 渲染端 bundle 体积、代码分割与 Electron 启动 | 0 | 0 | 3 | 2 |
| **合计** | **0** | **8** | **25** | **7** |

> 说明:部分发现被多个维度引用(如"无视口裁剪"在两个维度各出现一次,"containerDescendantCount"出现两次,"scrollback 2s 自动保存"贯穿三个维度)。下文**详细发现已按主题去重合并**,避免重复列举。

---

## 详细发现

### HIGH

#### H1 · Canvas 完全没有视口裁剪,每个可见节点都挂载完整的实时 DOM 子树
- **文件**:`src/renderer/src/components/Canvas/hooks/useCanvasVisibility.ts:40-48`(另见同维度重复项 `:40-59`)
- **类别**:missing-virtualization / layout-thrash
- **证据**:`visibleNodes = useMemo(() => filterCollapsedFrameDescendants(nodes), [nodes])` 是唯一的过滤。`filterCollapsedFrameDescendants`(`src/renderer/src/utils/frameHierarchy.ts:187`)只丢弃折叠 frame 的后代,**从不**把节点与视口矩形相交;`transform`(pan/zoom)甚至不是该 hook 的输入。下游 `CanvasSurface.tsx:248/266/267` 对全集 `renderGroups.containers.map(renderNode)` / `regular.map(renderNode)`,`CanvasNodeView/DefaultCanvasNode.tsx:218-269` 为**每个节点**无条件挂载重型 body:`TerminalNodeBody`(`TerminalNodeBody/index.tsx:183` `api.spawn` 真实拉起 PTY+xterm)、`FileNodeBody`(Tiptap)、`IframeNodeBody`(iframe)。
- **用户影响**:DOM 节点数、JS 堆(每节点一份 xterm buffer + 一个 PTY + 一个 Tiptap editor + 一个 iframe)、绘制成本均随**节点总数**增长。40 个终端/Agent/文件节点即便有 38 个被平移到屏幕外,仍付出 40 次完整挂载;初始加载与内存线性膨胀且不会回落。`CanvasNodeView` 已用 `React.memo`(`index.tsx:242`)挡住了"离屏节点的稳态重渲染",因此**主成本是挂载与常驻内存,而非每帧重渲染**。
- **修复建议**:把 `transform` 与容器尺寸传入 `useCanvasVisibility`(或新建 `useViewportCulling`),计算可见 canvas 矩形,排除 bbox(加约 1 个视口的 margin band)完全落在视口外的节点。始终挂载 selected/dragging/fullscreen/边端点 节点。对需保持挂载以保留 PTY/编辑器状态的节点,先渲染占位 div,仅当进入 margin band 时再懒挂载重型 body(`content-visibility:auto` 是更廉价的部分缓解,但不释放 PTY/JS 内存)。
- **置信度**:0.95

#### H2 · 任意 drag/resize 的每个 pointer-move 都替换整个 node 数组,重跑 Canvas 派生流水线
- **文件**:`src/renderer/src/hooks/useNodes.ts:586-617` / `src/renderer/src/components/Canvas/CanvasSurface.tsx:121-284`
- **类别**:re-render
- **证据**:`moveNode/moveNodes/resizeNode` 构造全新映射数组并在每个 rAF tick 调用 `applyNodes(resizeGroupsToChildren(movedNodes), false)` → `applyState` → `setNodes(nextNodes)`。`nodes` identity 改变后 `Canvas/index.tsx` 重跑 `useCanvasVisibility`(新建 Set/Map 遍历全集)→ `useCanvasRenderOrder`(`computeContainerDepths` + 全量 `[...visibleNodes].sort(...)` + 二次切分 containers/regular)→ 渲染**未 memo 化**的 `<CanvasSurface>`,其内联 `renderNode` 对整个 `renderGroups` 数组 `.map`。
- **用户影响**:drag/resize 期间,完整 O(n) 的 visibility+sort+split 流水线与全量 `.map` 以 rAF 频率为整个 canvas 重跑,是大 canvas 拖拽卡顿的主因。**缓解事实**:`CanvasNodeView` 已 `React.memo`(`index.tsx:221-243`),只有引用真正改变的节点(被拖节点 + 同伴)才重渲染其重型 body(Tiptap/终端/iframe),未变节点在 memo 边界 bail out。因此每 tick 是 O(n) 派生 + O(n) 元素创建/协调 + O(n) 比较器调用,**但不是 O(n) 深层 body 重渲染**;`dragPreview` HUD 的目的并未被完全抵消。
- **修复建议**:把实时 drag/resize 几何排除在正式 `nodes` 数组之外——手势进行中仅通过 CSS `translate`/`will-change` overlay(或按 id 的 position override map)驱动被拖节点,pointer-up 时一次性提交真实数组变更。另将 `CanvasSurface` 包 `React.memo`,并 memo 化 visibility/render-order 输入使其仅在节点 identity 真正改变时重算。
- **置信度**:0.9

#### H3 · `getCwd` 自动保存在主进程每 2 秒对每个 Agent/终端节点跑同步 `execSync(lsof/readlink)`
- **文件**:`src/main/terminal/pty-manager.ts:206-311`(handler `306-311`);调用方 `AgentNodeBody/useAgentNodeController.ts:886-893`、`TerminalNodeBody/index.tsx:234-241`
- **类别**:blocking-io
- **证据**:2 秒自动保存间隔调用 `await api.getCwd(sessionId)`。主进程 handler `ipcMain.handle('pty:getCwd', ...)` → `getCwd(proc.pid)` **同步执行**:darwin 上 `execSync('lsof -a -d cwd -p ${pid} ...')`、linux 上 `execSync('readlink /proc/${pid}/cwd ...')`(`pty-manager.ts:210,218`)。`execSync` fork 子进程并**阻塞 Electron 主进程事件循环**直至返回(各 timeout 2000ms)。
- **用户影响**:N 个活跃节点 → 主进程每 2 秒 fork N 个子进程仅为记录 cwd。macOS 上 lsof 常耗时数十到数百毫秒,每次调用都让主进程停顿,而主进程**串行化所有 IPC**(PTY 数据、文件写、store 保存)。表现:终端输出卡顿、打字延迟、保存延迟随终端数线性增长;单次慢 lsof(最高至 2s 超时)可冻结整个应用。
- **修复建议**:(1) 把 `getCwd` 改异步(linux 用 `fs.promises.readlink('/proc/${pid}/cwd')` 完全不 fork 子进程;否则用 `execFile`/`exec` 回调),使其永不阻塞主循环。(2) 从 2 秒 scrollback 保存中解耦——cwd 极少变化,仅在 spawn 与 shell 提示符返回时(或最多每 ~30s)读取,2 秒 tick 仅持久化 scrollback 并复用 `dataRef` 中的 last-known cwd;unmount(`useAgentNodeController.ts:1061`、`TerminalNodeBody/index.tsx:261`)同样复用缓存 cwd。
- **置信度**:0.92

#### H4 · 每个 xterm 容器上的 ResizeObserver 在每个缩放动画帧重新 fit + 重新同步字号(逐终端)
- **文件**:`TerminalNodeBody/index.tsx:281-293`;`AgentNodeBody/useAgentNodeController.ts:1083-1098`;成本函数 `AgentNodeBody/utils/terminal.ts:64-69,78-98`
- **类别**:layout-thrash
- **证据**:每个节点装 `new ResizeObserver(() => fitTerminalWithCanvasScale(...))`(终端版)/ `syncTerminalFontSizeToCanvas(...); fit.fit()`(Agent 版)。容器尺寸为 `calc(100% * var(--canvas-scale))`,缩放过渡在 0.32s 内动画化 `--canvas-scale`(`CanvasSurface.tsx:219-222`),故 observer 每动画帧触发。`fitAddon.fit()` 强制同步布局读取(`getComputedStyle` + 测量字符 cell)与回流;`syncTerminalFontSizeToCanvas` 亦调用 `getComputedStyle`。
- **用户影响**:单次 pinch/zoom 中,每个活跃终端在 ~20 个动画帧上各跑 `getComputedStyle` + `fit()`,N 个终端 → N×~20 次强制回流,是 canvas 上有终端时缩放卡顿的主因。**更正**:`term.refresh()` **不**在任一 ResizeObserver 内运行(它在无关的 `fitAndRefreshTerminal` 中),故每帧每终端真实成本是 `getComputedStyle` + 一次 `fit()` 回流(仅当 cols/rows 改变时才会重绘 xterm),并非无条件重栅格化。
- **修复建议**:用 rAF 合并 observer,使每帧最多一次 `fit`,缩放结束后做一次最终 fit(trailing setTimeout,每次触发清掉前一个)。当新测尺寸等于上次 fit 尺寸时跳过。可在 `canvas-transform--moving`/动画期间暂停 fit,动画结束后做一次 fit。`syncTerminalFontSizeToCanvas` 已在字号不变时早返回——以同样方式 gate `fit()`。
- **置信度**:0.85

#### H5 · 完整 xterm scrollback 每 2 秒被遍历并 join 成字符串,然后触发整个 nodes 数组替换 + 防抖磁盘写
- **文件**:`AgentNodeBody/utils/terminal.ts:34-46`;`AgentNodeBody/useAgentNodeController.ts:886-893`;`TerminalNodeBody/index.tsx:30-42,234-241`(自带重复的 `serializeBuffer`);经 `useNodes.ts:454-462` 与 `useNodeHistory.ts:41-67`
- **类别**:GC/CPU + 磁盘 I/O churn(原标 layout-thrash,实无强制回流)
- **证据**:`serializeBuffer` 遍历整个 active buffer(`for i in count: translateToString(true)` 后 `lines.join('\n')`,`terminal.ts:36-42`),在 2 秒间隔与 unmount 时各跑一次。结果经 `onUpdateRef.current(...)` → `updateNode`(`nodesRef.current.map(...)`,`useNodes.ts:456`)→ `applyNodes` → `applyState` → `pushSnapshot`(新建 history 快照)→ `scheduleSave()`(800ms 防抖、全 canvas JSON 写)。
- **用户影响**:xterm scrollback 上限为 **5000** 行,`translateToString` 每 tick 为每行分配字符串。N 个忙终端 = N 次全 buffer 遍历 + N 次全 nodes `.map` + N 次 history 快照 push,每 2 秒;外加 800ms 防抖的全 canvas 序列化/磁盘写。主线程 GC churn 与持续磁盘 I/O 随终端数增长。**额外副作用**:每个 2 秒 tick 都 push 一个 undo-history 快照(`addToHistory` 默认 true),实时终端输出持续灌满 100 项 undo 栈——属性能成本之上的 UX 正确性 bug(见 H/M 交叉项 M-Hist)。
- **修复建议**:(1) 用 `@xterm/addon-serialize`(或 cache+diff)替代每 tick 全 buffer 遍历;仅在 buffer 真正改变(`term.onWriteParsed`/onData 设脏标志)时重序列化。(2) 从尾部切到 `MAX_SCROLLBACK_CHARS`。(3) scrollback 自动保存走**不 push undo 快照**的专用路径:加 `scrollback-only` 更新,只改 `nodesRef` + `setNodes`,不走 `applyState`/`pushSnapshot`,让现有 800ms 防抖合并磁盘写。
- **置信度**:0.92

#### H6 · `canvas:save` 把完整的 读-合并-写 流水线跑两遍,为持久化一个改动节点做 ~5N 次磁盘读
- **文件**:`src/main/canvas/store.ts:1161-1208`
- **类别**:blocking-io
- **证据**:`withSaveLock` 内 `firstPass = await mergeExternalNodes(...)` 后再 `merged = await mergeExternalNodes(payload.id, firstPass)`。每次 `mergeExternalNodes` → `readDiskCanvas` → `readCanvasFull(id)`,含 `recoverInterruptedMigration`(readSentinel)+ 读 `canvas.json` + `assembleV2`(`Promise.all(layoutNodes.map(readNodeFile))`,每节点一次读)。两次 merge = 2×(canvas.json + N 次节点读)。随后 `writeCanvasFull` → `writeCanvasFullV2` 对每节点 `readNodeFile`(又 N 次读)+ 每节点一次写;再 `readOnDiskNodeMap`(1 读)+ `seedPerNodeContent`(readdir + N 读)。N 节点的单次保存约 **5N 次文件读 + N 次写**,即便只有 1 个节点改变。
- **用户影响**:数十/数百节点的 workspace,每次自动保存(终端 scrollback 每 2s、drag-end、任意编辑)让主进程做数百次 fs round-trip。多个活跃终端各每 2s 触发时会饱和主线程/IO 并拖慢所有 IPC。**精确化**:I/O 是异步的(走 libuv 线程池,不是同步阻塞 JS 主线程整段时间),但线程池/IO 饱和 + 主进程上的 JSON parse/serialize CPU + IPC 响应性下降的实际效果成立。
- **修复建议**:只调用一次 `mergeExternalNodes`(`writeCanvasFullV2` 内的逐节点 `updatedAt` 仲裁已防护第二遍要防的竞态);缓存 `readCanvasFull` 结果,避免 `readDiskCanvas` 与后续写各自重读每个 `nodes/<id>.json`;最关键——让 `writeCanvasFullV2` **只写数据真正改变的节点**(用单次磁盘快照 diff),而非每次保存都对每个节点 read+write。
- **置信度**:0.9

#### H7 · `markdown.render` 为每个无语言提示的代码块跑 `highlightAuto`,放大每 token 重解析成本
- **文件**:`src/renderer/src/components/chat/utils/markdown.ts:18-40,140-142`
- **类别**:blocking-io / CPU
- **证据**:`renderCodeBlockHtml` → `highlightCode`:无/未知语言时 `hljs.highlightAuto(code)`(`markdown.ts:33-39`)跨所有常见语言做自动检测(已知语言走更廉价的 `hljs.highlight`)。`renderMarkdown`(`140`)被 `renderMdWithMentions` 调用,而 `ChatMessage` 的 `useMemo` 按 `[message.content]` 触发——流式时每 token 重跑。
- **用户影响**:`highlightAuto` 是 hljs 最昂贵操作之一(尝试多种语法)。在不断增长的代码块上每 token 重跑,是大型同步主线程成本,随代码长度与 token 速率增长,是代码密集回复流式卡顿的首要贡献者。因 delta append 无节流(`useChatStream.ts:246`)且 `renderMarkdown` 无缓存,所有代码块每 token 都被重 highlight。
- **修复建议**:在途流式消息**不**跑完整 markdown+highlightAuto——流式时渲染转义后的原文,完成时跑一次 highlight。若需增量,按代码块精确字符串 memo 化 highlight 结果,优先显式语言提示而非 `highlightAuto`。
- **置信度**:0.9

#### H8 · `buildGraphData` 每次 toggle/visibleNodes 变化产出新 graphData,layout effect 在每次 nodes/links 计数变化时 reheat 模拟 + zoomToFit
- **文件**:`WorkspaceNodes/GraphPage.tsx:337-346,409-430`
- **类别**:layout-thrash
- **证据**:`graphData = useMemo(() => buildGraphData(...), [showLinks, showTags, showWorkspaceHubs, tags, t, visibleNodes, workspaces])` 重建完整 nodes/links。新引用传给 `<ForceGraph2D graphData={graphData}>` 触发全量 re-ingest。另:`useEffect(() => { graph.d3ReheatSimulation(); setTimeout(() => graph.zoomToFit(450,140), 60); }, [graphData.links.length, graphData.nodes.length, layoutPreset])`。
- **用户影响**:toggle `showTags/showLinks/showWorkspaceHubs/showOffCanvas` 或任何 live reload 都重建数组并喂给 ForceGraph 新对象,丢弃 x/y 位置、冷启动模拟、强制 `zoomToFit`(视口跳变 + CPU 尖峰)。即便只通过 live refresh 加了一个节点,计数变化也会触发 reheat。
- **修复建议**:ForceGraph 原地变更 node 对象以保留 x/y——按 id 复用先前 `NodeObject` 实例(拷贝 x/y/vx/vy)使模拟 warm-start;仅在 `layoutPreset` 改变或真正结构变化时 gate `d3ReheatSimulation()` + `zoomToFit`(单节点新增不 reheat);对 live `onChange` reload 做防抖。
- **置信度**:0.85

#### H9 · `useMountedWorkspaceIds` 从不驱逐已访问 workspace + Canvas 无视口虚拟化(keep-alive 叠加)
- **文件**:`Workbench/useMountedWorkspaceIds.ts:11-37`;叠加 `Canvas/hooks/useCanvasVisibility.ts:40-59`(见 H1)
- **类别**:memory-leak(刻意 keep-alive 设计)
- **证据**:该 hook 只 ADD 不 evict(唯一移除路径是"workspace 已不存在"的删除剪枝),无 LRU/上限/空闲驱逐。`Workbench` 为 set 中每个 id 挂载一个完整 `<Canvas>` + 一个 `<ChatPanel>`(`index.tsx:412,468`),隐藏者仅 `display:none`。每个 Canvas 挂载整个 `useNodes/useCanvas*` hook 栈,隐藏 workspace 的活跃终端/Agent(`WorkspaceTerminalPortal`,`index.tsx:491`)保持 PTY 运行。
- **用户影响**:一个会话访问 N 个 workspace 后,N 个完整 canvas + N 个 chat panel + 所有 PTY/编辑器保留至应用生命周期结束;内存单调增长,切换 workspace 从不回收。多个重型 workspace 时渲染端内存与稳态 CPU 持续攀升直到 reload。**限定**:这是有意的 keep-alive 设计(`index.tsx:463-466` 注释说明),增长被会话内打开的不同 workspace 数所界定(非真正无界),故 medium 倾向但与 H1 叠加后实质为 high。
- **修复建议**:用 LRU keep-alive 限定挂载集(active + 最近 K=2-3 个),驱逐其余并拆除其 Canvas/ChatPanel/终端;始终保留 active id 与任何有运行中 Agent/终端 turn 的 id(避免杀掉在途工作)。

---

### MEDIUM

#### M1 · `containerDescendantCount` 在每个 group/frame 的每次渲染重算 `computeParentContainerMap`(O(n×containers))
- **文件**:`CanvasNodeView/useCanvasNodeViewModel.ts:245-247`(同一发现在两个维度各列一次,此处合并)
- **类别**:n-plus-1
- **证据**:`const containerDescendantCount = (node.type === 'group' || node.type === 'frame') && getAllNodes ? collectContainerDescendants(node.id, getAllNodes()).length : 0;` 在 view-model body 无 memo 运行。`getAllNodes()` 返回 `nodesRef.current`(全集);`collectContainerDescendants`(`frameHierarchy.ts:115-119`)调 `computeParentContainerMap(nodes)`(`frameHierarchy.ts:69-101` 的 O(nodes×containers) 双循环)。
- **用户影响**:`CanvasNodeView` 的 memo(`prev.node===next.node` 等)将重渲染限于 props 真正改变的节点,**因此并非全 canvas 每帧 C 次并发**。真实成本是:每当**单个** frame/group 节点重渲染(尤其拖动该容器时每个 rAF tick,因 `moveNode` 创建新 node 对象),就从头跑一次完整 O(N×containers) 父图计算。在 container 密集 canvas 上拖一个 frame = 每动画帧一次 O(N×C) pass,导致拖拽 jank。`getAllNodes` 本身是稳定 `useCallback`,非重渲染触发源。
- **修复建议**:在 Canvas 层 `useMemo` over `nodes` 计算一次父容器图,以 `Map<containerId, number>` 经 context/prop 暴露后代计数,view-model O(1) 读取,而非每容器重算 `computeParentContainerMap`。同样修复 `useCanvasRenderOrder` 对相同数据重算 depths。
- **置信度**:0.85-0.9

#### M2 · `CanvasSurface.renderNode` 是每次渲染重建的内联非 memo 闭包,逐节点传 ~31 个 props
- **文件**:`Canvas/CanvasSurface.tsx:174-212`
- **类别**:re-render
- **证据**:`renderNode = (node, renderMode='full') => (<CanvasNodeView key=... node={node} ...~31 props... />)` 声明在 `CanvasSurface` 函数体内,每次渲染重建;`CanvasSurface` 未 `React.memo`,且在每次 `setTransform`(`hooks/useCanvas.ts:66/79/110`,每个 wheel/mousemove 事件触发)时重渲染。`.map`(`248/266/269`)随后为每个可见节点在每个 pan 帧重建 React 元素。
- **用户影响**:每个 pan/zoom 帧分配 N 个新元素对象并对所有可见节点跑 `CanvasNodeView` memo 比较器(`index.tsx:221-243`,~20 次 prop 比较)。memo bail out 使 body 不重渲染,但元素构造 + 比较仍是每帧 O(n) 主线程成本——大 canvas 连续平移时的可测开销(故 medium 非 high)。
- **修复建议**:把 transform 与节点渲染解耦——在 wheel/pan handler 内用 ref + 直接 style 写(或 CSS 变量)驱动 `.canvas-transform` 的 translate/scale,使 React `transform` state 离开热路径;另将 `CanvasSurface` 包 `React.memo`,把节点列表提到只依赖 renderGroups/selection/drag(不依赖 transform)的 memo 化子组件。
- **置信度**:0.9

#### M3 · scrollback 自动保存历史污染:每 2s tick 占一个 undo 槽并强制全 nodes 数组拷贝
- **文件**:`useNodes.ts:454-462`;`useNodeHistory.ts:28-34,41-59`
- **类别**:re-render / UX 正确性
- **证据**:`updateNode` → `applyNodes(resizeGroupsToChildren(...))` 默认 `addToHistory=true`,每次自动保存跑 `pushSnapshot`(slice + push + 超 `MAX_HISTORY=100` 时 shift)与 `resizeGroupsToChildren`(最多 4 pass 的全 nodes `.map`)。scrollback 写走与用户编辑相同的通用路径。
- **用户影响**:几个活跃终端时,undo 栈在数分钟内被纯 scrollback 快照填满,**Ctrl+Z 回放的是终端文本自动保存而非真实编辑**(主要、始终存在的危害);CPU 角度次要(无 group 时 `resizeGroupsToChildren` 单 pass 短路)。故 medium(UX 正确性退化)。
- **修复建议**:为自动保存加专用低优先级节点数据更新器:(a) 跳过 `pushSnapshot`(无 undo 项),(b) 跳过 `resizeGroupsToChildren`(scrollback/cwd 不改几何)。终端/Agent 自动保存调它而非通用 `updateNode`。
- **置信度**:0.9

#### M4 · 团队 Agent 输出在主线程逐 chunk 经序列化异步队列 + 每会话锁 + 全量 ANSI strip 解析
- **文件**:`src/main/agent-teams/pty-bridge.ts:52-61` → `src/main/agent-teams/service.ts:1566-1601`
- **类别**:CPU(原标 blocking-io,实为内存内 store,无逐 chunk 磁盘 I/O)
- **证据**:`pty-bridge` onData 为每个 chunk enqueue `reportAgentOutput`。`reportAgentOutputLocked` 在 `withTeamLock` + `resolveAgentNodeCached` 下做:`stripAnsi(previous+delta).slice(-MAX_AGENT_OUTPUT_BUFFER)`、`combined.split(/\r\n|\n|\r/)`、逐行 `parseAgentOutputMarker`——主进程逐 chunk。
- **用户影响**:重团队输出时,主进程在每会话异步锁后重复 re-ANSI-strip 滚动 buffer + 重切分/扫描每行(每 chunk),与 PTY IPC 争抢事件循环。**缓解**:rolling buffer 硬上限 `MAX_AGENT_OUTPUT_BUFFER=16_000` 字符,`nodeQueues`/`withTeamLock` 异步运行(非同步阻塞)。
- **修复建议**:用 H/M 交叉项 M-IPC 提议的合并 flush 驱动,使 `reportAgentOutput` 每 flush 窗口调一次而非每原始 chunk,把锁获取、`stripAnsi`、split 数量降一个量级。
- **置信度**:0.85

#### M-IPC · PTY `onData` 逐 chunk 扇出到渲染端 IPC + 每个 observer,零批处理
- **文件**:`src/main/terminal/pty-manager.ts:281-287`
- **类别**:ipc
- **证据**:`proc.onData((data) => { if (!win.isDestroyed()) win.send(\`pty:data:${id}\`, data); notifyObservers((o) => o.onData?.(info, data)); })`——每个原始 PTY chunk 触发一次结构化克隆 + IPC send + 同步遍历所有已注册 observer。Claude/Codex 全屏重绘会发出大量小 chunk。
- **用户影响**:高吞吐 Agent 输出(屏幕重绘、spinner)产生 IPC 洪流——主进程 CPU 尖峰、渲染端事件循环饱和。**缓解**:xterm.js 内部把实际渲染批到动画帧,故渲染端绘制部分受限;主导真实成本是逐 chunk IPC 结构化克隆、`term.write` 解析、`captureTerminalOutput` 与同步 observer 循环,随并发会话数增长(故 medium 非 high)。
- **修复建议**:在跨 IPC 边界前按 microtask/动画节奏合并每会话输出——按 id 缓冲 chunk,`setImmediate`/~8-16ms 定时器 flush,发一条拼接 `pty:data:${id}` 并每 flush 调一次 observer;保留 max-buffer 上限以约束延迟。
- **置信度**:0.85

#### M-Exec · `execInSession` 累积无界输出 buffer 并对增长字符串每 chunk 跑 `includes/indexOf`(O(n²))
- **文件**:`src/main/terminal/pty-manager.ts:406-441`
- **类别**:blocking-io
- **证据**:`let output=''; ... output += data; if (capturing && output.includes(endMarker)) { output.indexOf(endMarker) ... }`——`output` 从不截断,每个 onData chunk 做 `includes` + `indexOf`(各 O(buffer 长度))。N 字符经 K chunk = O(N×K)≈O(N²)。`finalOutput.lastIndexOf('\n')` 等只在完成时跑一次,非逐 chunk 成本。
- **用户影响**:产出大输出(构建日志、测试、文件 dump)的命令使每个 chunk 扫描成本递增,在主线程阻塞事件循环(也服务所有 PTY/window/agent-teams IPC),受 30s 超时界定。
- **修复建议**:只扫新到尾部:`searchTail = (searchTail + data).slice(-(endMarker.length*2))` 测 marker,或 `indexOf(endMarker, scannedUpTo)`;append 到数组、完成时 join 一次而非 `+=`;并对总捕获量加上限。
- **置信度**:0.9

#### M-Mirror · Mirror 终端在 detached/离屏时仍保持活跃 `pty:data` IPC 订阅并 `term.write`(unmount 未退订)
- **文件**:`AgentNodeBody/useAgentNodeController.ts:415-443,67-90`
- **类别**:memory-leak(有界)
- **证据**:mirror unmount 清理仅 `detachMirrorTerminal(liveEntry)`(`443`),它只把 xterm DOM 移入隐藏 stash,**不**调 `entry.disposeSubscriptions()`;后者仅在 `pruneMirrorTerminalCache` 超 `MAX_MIRROR_TERMINALS=12` 驱逐时(`disposeMirrorTerminal`)调用。故最多 12 个缓存 mirror 终端持续订阅 `pty:data:${sessionId}` 并对每个 chunk 跑 `term.write`,即便节点离屏/已 unmount。
- **用户影响**:团队视图中,每个队友的高吞吐 PTY 输出仍被 IPC 投递并写入最多 12 个隐藏、从不渲染的 xterm——纯浪费 IPC + xterm 解析/buffer 工作 + 常驻内存(12 终端 × scrollback)。**精确化**:主进程每会话发一次事件(不随订阅者数放大),成本是保留的 listener 调 `term.write`,且被 12 上限 + 有界 scrollback 界定(有界 leak)。
- **修复建议**:detach 时也拆除离屏 mirror 的 IPC 订阅(在 `detachMirrorTerminal` 调 `disposeSubscriptions()`),reattach 时从保存的 scrollback 重订阅 + 重绘;至少 gate `term.write` 使 detached mirror 丢弃数据。保留 Terminal 对象以快速 reattach 可以,保留其活跃 PTY 订阅是 leak。
- **置信度**:0.9

#### M-Chat1 · 逐 token `onTextDelta` 做整 messages 数组拷贝 → 重渲染每个 ChatMessage;未 memo 的 ChatMessage 每 token 重解析 markdown
- **文件**:`chat/hooks/useChatStream.ts:240-249` + `ChatMessage.tsx:95-118`
- **类别**:re-render
- **证据**:`onTextDelta` 每 token:`setMessages(prev => { const next=[...prev]; next[index]={...next[index], content: ...+delta}; return next; })`——每 token 新数组 + `assistantIndex` 处新对象 identity。`ChatMessages.tsx:257` 的 `.map` 对全列表重跑,`ChatMessage` 是普通函数(`95` 行,**未** `memo`),故每个兄弟消息也重渲染。`ChatMessage` 内 `assistantHtml = useMemo(() => renderMdWithMentions(message.content, nodes), [message.role, message.content, nodes])` 每 token 重解析在途消息的完整 markdown。
- **用户影响**:流式速度下(每秒数十到数百 token),活跃消息的 markdown+语法高亮从头重跑(代码块时 `highlightAuto` 对增长 buffer 跑 = O(n²) 总 CPU)。**更正**:兄弟(非流式)消息会重渲染(函数体执行 + vdom diff),但**不**重解析 markdown(其 `useMemo` 由稳定 `message.content/nodes` 守护),故 markdown/高亮成本停留在单个流式消息——主导成本是该消息的 O(n²) 重解析。
- **修复建议**:(1) `ChatMessage` 包 `React.memo`;(2) 节流/合并 text delta——缓冲后经 rAF flush 到 `setMessages`(每帧一次 setState);(3) 在途消息渲染纯文本/更廉价 pass,完成时才跑完整 markdown+highlight,或按代码块内容 memo 化 highlight。
- **置信度**:0.85

#### M-Chat2 · `publishTools()` 在每个 tool-input delta 与每个 `onVisualStream` 帧(~60fps)拷贝数组 + 克隆 Map,重渲染 tool chip 与流式 visual
- **文件**:`chat/hooks/useChatStream.ts:142-148,171-212`
- **类别**:re-render
- **证据**:`publishTools = () => { const snapshot=[...toolCalls]; setStreamingTools(snapshot); if (assistantIndex.current>=0) setMessageTools(prev => new Map(prev).set(assistantIndex.current, snapshot)); }`,被 `onToolInputDelta`(每 arg-token,`174-176`)与 `onVisualStream`(`211`,~60fps)调用。每次分配新数组 + 新 Map 喂 setState。
- **用户影响**:**更正**:React 18 自动批处理把单个 IPC handler 内的两次 setState 合并为一次 commit,故是 ~60 渲染/秒而非 120;且 `ChatMessage` 的 markdown `useMemo`(按 `message.content`,流式 tool-arg/visual 时不变)被跳过,churn 是随列表长度增长的 vdom diff。整体是 ~1.4s 动画期间全列表 ~60fps 重渲染,与动画争抢但通常非灾难性。
- **修复建议**:经 rAF 调度合并 `publishTools`(置脏标志,每帧最多 flush 一次);memo 化 `ChatMessage`/`ChatToolCalls` 使只有流式消息的 chip 子树更新;在途消息不再同时维护 `streamingTools` 与 `messageTools` 条目(流式分支已读 `streamingTools`,每帧 `new Map(prev).set` 克隆冗余)。
- **置信度**:0.88

#### M-Save1 · `writeCanvasFullV2` 每次保存读写每个 per-node 文件,即便未改动
- **文件**:`src/main/canvas/storage.ts:886-927`
- **类别**:blocking-io
- **证据**:`for (const node of nodes) { const existing = await readNodeFile(...); ... await writeNodeFile(...); }` 无变化检测;每个节点都 `readNodeFile` 且(除非磁盘严格更新)`writeNodeFile`(`atomicWriteJson` = tmp 写 + rename,逐文件)。移动一个节点仍重写全部 N 个 `nodes/<id>.json`。
- **用户影响**:每次保存 O(n) tmp 创建 + rename。watcher 放大被三层 echo 抑制(精确字节、`visibleFieldsChanged`、`markSelfWrites` 时间戳)去重,故单次逻辑保存**不**产生 N 次虚假渲染端广播——净影响是浪费的磁盘 churn(O(n) 原子写 + O(n) watcher read-back),非渲染/广播风暴。这是防抖保存路径、典型数十节点,故 medium。
- **修复建议**:跳过序列化记录字节相同(或 `updatedAt` 未变)的节点。渲染端仅对真正变更节点 bump `updatedAt`,比对 incoming `updatedAt` 与 store 已有的 `lastPerNodeContent` 快照,只写 diff——move-only 改动应写 1 个文件而非 N 个。
- **置信度**:0.9

#### M-Save2 · 终端 scrollback 自动保存(每终端每 2s)驱动整个保存流水线做全 canvas 序列化
- **文件**:`TerminalNodeBody/index.tsx:234-241`
- **类别**:blocking-io(实为冗余异步 I/O + JSON 序列化 CPU,无 UI 线程阻塞)
- **证据**:`setInterval(async () => { const scrollback = serializeBuffer(term); onUpdateRef.current(nodeId, { data: {...scrollback...} }); }, 2000)`,每终端独立。`onUpdate` → `updateNode` → `scheduleSave`(800ms 防抖)。
- **用户影响**:k 个活跃终端 → 渲染端每 ~2s/k 入队一次保存;每个幸存(防抖后)保存序列化整个 canvas(所有节点 + scrollback)经 IPC,主进程跑 H6 的 O(N) 读-合并-写。成本随终端数与节点总数增长,与实际改动多少无关。800ms 防抖摊销突发,`updatedAt` 仲裁跳过磁盘更新的写,故 medium。
- **修复建议**:仅当序列化 scrollback 与上次持久化值不同才调度保存(跳过 no-op tick);或经只写 `nodes/<id>.json` 的专用单节点 IPC 路径持久化,而非把整个 canvas round-trip 经 `mergeExternalNodes`。
- **置信度**:0.9

#### M-Save3 · 隐藏终端节点的 2s scrollback+getCwd 自动保存间隔在 `display:none` 时从不暂停
- **文件**:`TerminalNodeBody/index.tsx:234-241`;Agent 版 `useAgentNodeController.ts:886-893`
- **类别**:blocking-io / 后台浪费
- **证据**:`setInterval` 在 spawn effect 创建,无 `isActive`/visibility gate。因隐藏 workspace 保持挂载(H9),每个已访问 workspace 的每个终端/Agent 节点持续触发此定时器。
- **用户影响**:跨所有挂载 workspace 的每个终端/Agent 节点每 2s 序列化完整 xterm buffer(CPU+GC churn)+ 发 `getCwd` IPC round-trip + `onUpdate` 写回。M 个终端 × N 个 keep-alive workspace = M 定时器 × 0.5 IPC/s 不可见后台主线程工作。隐藏 workspace 的 canvas host 为 `display:none`,故写回触发 React 协调/持久化但**不**触发那些 canvas 的视觉布局/绘制。属稳态低频后台工作(可扩展性/电量问题),故 medium。
- **修复建议**:把间隔 gate 在 visibility 上——向 `TerminalNodeBody`/`AgentNodeBody` 传 `isActive`/`visible`,隐藏时清间隔(隐藏时做一次最终持久化,显示时恢复)。更廉价:仅当 buffer 自上 tick 真正改变(`term.onData` 脏标志)才序列化+持久化,且除非有影响 cwd 的输入否则跳过 `getCwd` IPC。
- **置信度**:0.9

#### M-Keep1 · 每个挂载(隐藏)Canvas 保持活跃 `canvas:external-update` IPC 订阅,对所有 workspace 的广播都唤醒
- **文件**:`useNodes.ts:154-270`
- **类别**:ipc
- **证据**:`useNodes` 按 canvasId 订阅:`storeApi.onExternalUpdate(async (event) => { if (event.workspaceId !== canvasId) return; ... })`。主侧广播无条件扇出到每个窗口(`broadcast.ts:17` `for (const win of BrowserWindow.getAllWindows()) win.webContents.send('canvas:external-update', payload)`)。guard 在 JS 中,故每个订阅者对每个广播仍被唤醒;匹配者 `await storeApi.load(canvasId)`(全盘读 + JSON parse)并重建节点列表。
- **用户影响**:**更正**:每个事件只有 1 个 workspace id 匹配,故是 1 次全 reload +(N-1)次 trivial 早返回(可忽略);merge/重建与 `storeApi.load` 在**渲染端**(`load()` 经 ipcRenderer.invoke,磁盘读/parse 在主进程、不在渲染端关键路径)。真实成本:每次外部变更,目标 workspace 重读+重 parse 完整 `canvas.json` 并重建节点数组 + 重渲染,即便隐藏;Agent/teams 的多次 `broadcastCanvasUpdate` 放大 reload 次数。界定于每事件一个匹配 workspace,故 medium。
- **修复建议**:仅为 active(可见)canvas 挂载外部更新订阅,或在源头过滤(主侧维护 per-workspace 订阅者注册表而非 `getAllWindows()`);至少对 per-event `storeApi.load` 防抖,使突发 `broadcastCanvasUpdate` 合并为一次磁盘读。
- **置信度**:0.85

#### M-Keep2 · 共享 `allNodes` map 在每个隐藏终端/Agent 的 2s 自动保存时 churn,经不稳定 `resolveReference` 回调重渲染所有挂载 Canvas
- **文件**:`Workbench/useWorkbenchState.ts:98-104`
- **类别**:re-render
- **证据**:隐藏终端/Agent 每 2s `onUpdate` → Canvas `updateNode` → `onNodesChange` → `handleNodesChange`:`setAllNodes((prev) => { if (prev[workspaceId]===nodes) return prev; return { ...prev, [workspaceId]: nodes }; })`——替换 `allNodes` 对象 identity。在 `Workbench/index.tsx`,`allNodes` 是 `resolveReferenceNode`(`216`)、`resolveReferenceSource`(`226`)、`createReferenceNodeFromEntry`(`270`)、`pasteReferencesIntoCanvas`(`350`)、`updateReferenceSourceNode`(`386`)的依赖,每次 `setAllNodes` 重建这些回调,作为 prop 传给**每个**挂载 `<Canvas>`(`index.tsx:442-450`)含 active 者。
- **用户影响**:隐藏 workspace 的后台终端每 2s 强制新 `allNodes` 对象,重建引用解析回调并重渲染 active Canvas(及每个挂载 Canvas)。**根因**:`allNodes` 是 Workbench state 且 Canvas 未 `React.memo`,Workbench 重渲染本身就重渲染每个挂载 Canvas(即便回调稳定);不稳定回调是会击溃 memo 化的加重因素。属空闲协调/GC churn(非正确性 bug),随终端数增长,故 medium。
- **修复建议**:把 per-workspace 引用解析与整 map identity 解耦——`allNodes` 存 ref,暴露稳定 `getWorkspaceNodes(id)`(`useWorkbenchState.ts:94` 已存在),使 resolve* 回调依赖稳定 getter 而非 `allNodes`,再 memo 化传入 Canvas 的回调;另节流终端 scrollback 持久化(见 M-Save3)使隐藏节点根本不写回。
- **置信度**:0.8

#### M-Keep3 · `PulseRouter` keepAlive 让整个 canvas 路由子树保持挂载,叠加多 canvas keep-alive
- **文件**:`router/index.tsx:56-67`
- **类别**:re-render / 后台浪费
- **证据**:`PulseRouterView` `keepAlive` 渲染 `<div style={isActive ? {display:'flex'} : {display:'none'}}>{children}</div>`,children 从不 unmount 只隐藏。`App.tsx:513` 把 `<Workbench>` 包在 `<PulseRouterView name='canvas' keepAlive>`。叠加 Workbench 自身 per-workspace `display:none`,canvas 子树(所有 N 个挂载 canvas + 其 hook/定时器/订阅)在用户处于 /chat、/nodes、/graph 或任意插件路由时仍完全挂载。
- **用户影响**:离开 canvas 到 chat/nodes/graph **不**静默 canvas——其 `useNodes` IPC 订阅、终端/Agent 2s 间隔、PTY 全在隐藏 div 背后运行;用户在每个其它路由也付全部 canvas 后台成本。
- **修复建议**:此 keepAlive 对 canvas 状态保留是有意的,但不应保持后台**工作**运行。与上述驱逐/可见性 gating 结合:canvas 路由非 active 时,暂停 canvas 的定时器与外部更新订阅(传 `routeActive` 标志经 Workbench → Canvas → useNodes/终端 hook),同时保持 DOM/组件状态挂载。
- **置信度**:0.9

#### M-Graph1 · `renderNode` 对选中/悬停节点逐节点逐帧做 `ctx.save/restore` + `measureText` + 带 shadowBlur 的 `roundRect`
- **文件**:`WorkspaceNodes/GraphPage.tsx:481-561`
- **类别**:layout-thrash
- **证据**:`nodeCanvasObject={renderNode}`,每个可见节点每帧 `ctx.save()` ... `ctx.measureText(label).width` ... `ctx.roundRect(...)` ... `ctx.restore()`。label 在 `showLabels`(默认 true)或 `globalScale>2.3` 时绘制。**更正**:`shadowBlur=14` 仅对 `isSelected||isHovered`(`506-509`,每帧至多 ~2 节点)设置,绘 label 前重置为 0,**非**每节点成本。
- **用户影响**:节点多 + label 开启时,force-graph 渲染循环在模拟/pan/zoom 期间每帧每节点跑 `measureText` + fill + roundRect path。`measureText` 是已知昂贵的 canvas 调用;大图(数百+节点)主动模拟/pan/zoom 时持续高 CPU 与掉帧。工作有界且每节点廉价,故 medium。
- **修复建议**:按 (label, fontSize bucket) 缓存测量宽度(可变 ref `Map<string, number>`,字号 bucket 变时失效),使 `measureText` 每 label 一次;缩放阈值以下完全跳过 label 绘制(force-graph 标准模式);仅重置实际触碰的属性以避免无谓 `save()/restore()`。
- **置信度**:0.82

#### M-Graph2 · `searchSuggestions` 每次按键经 `tagName` 线性扫描做 O(nodes × tagsPerNode × totalTags)
- **文件**:`WorkspaceNodes/GraphPage.tsx:284-318`
- **类别**:n-plus-1
- **证据**:`visibleNodes.filter((node) => [node.id, node.workspaceName ?? '', getNodeTitle(node, ''), node.summary ?? '', ...node.tags.map((tagId) => tagName(tagId, tags))].some((value) => value.toLowerCase().includes(q)))`。`tagName` 是 `tags.find((t) => t.id===tagId)?.name`(`utils.ts:87-89`),每 tag 每 node 一次线性扫 `tags`。memo deps `[visibleNodes, query, tags, showTags]`,每按键重跑。
- **用户影响**:每按键全量扫 `visibleNodes` 并以 O(totalTags) 解析每个 tag 名,字符串每次重新小写。节点/tag 多时是显著的每按键主线程成本,搜索框输入卡顿。
- **修复建议**:从 `tags` 一次性 memo 化构建 `Map<tagId,name>` 传给 `tagName` 使查找 O(1);按 `visibleNodes`/`tags`(非 `query`)memo 化每节点小写化 haystack,使按键只做子串匹配;可在凑够 12 结果时早退。
- **置信度**:0.85

---

### LOW

#### L1 · `resizeGroupsToChildren` 每次变更运行,对无 group 节点的 canvas 无早退
- **文件**:`useNodes.ts:399-452`
- **类别**:layout-thrash
- **证据**:`for (let pass=0; pass<4; pass++) { const byId = new Map(current.map(n => [n.id, n])); const resized = current.map(n => n.type !== 'group' ? n : ...); if (!changed) return current; current = resized; }`。从 `updateNode/removeNode(s)/syncDeletedNodes/ungroupNodes/moveNode(s)/resizeNode/duplicateNode/pasteNodes/groupNodes/wrapNodesInFrame` 调用,**进循环前无 group 检查**——零 group 也建 `new Map(...)` + 全 `current.map(...)`(pass 0)。
- **用户影响**:每个 move/resize tick(与自动保存叠加,rAF 频率)至少分配一个全节点 Map + 一次全数组 map,即便零 group——纯浪费主线程工作 + 与节点总数成比的 GC 压力。空闲时不运行。
- **修复建议**:顶部早退 `if (!nextNodes.some((n) => n.type === 'group')) return nextNodes;`;更佳:预算 group 集,传 `touchedIds` hint 使只重算 childIds 与移动 id 相交的 group。
- **置信度**:0.88

#### L2 · 逐节点 `setInterval` 相对时间 tick,每节点一个定时器
- **文件**:`CanvasNodeView/useCanvasNodeViewModel.ts:81-85`
- **类别**:re-render / 定时器 churn(原标 memory-leak 不准——cleanup 正确,无无界泄漏)
- **证据**:`useEffect(() => { if (!node.updatedAt) return; const id = setInterval(() => setTick((t) => t+1), 30_000); return () => clearInterval(id); }, [node.updatedAt])`——每个 `CanvasNodeView` 装自己的 30s 间隔,dep 是 `node.updatedAt`(每次 move/resize/update 都改)。
- **用户影响**:N 个并发 30s 定时器(每可见节点一个),每 30s 各强制一次本地状态更新 + **仅该节点**重渲染(非全 canvas)。因 dep 是 `node.updatedAt`,拖一个节点会在每次手势提交时拆/重建其间隔(定时器 churn)。净用户影响 low——许多廉价空闲 30s 唤醒 + 瞬态间隔重建,非泄漏或重渲染风暴。
- **修复建议**:把相对时间提升为单个共享 ticker(canvas 层一个间隔经 context,bump 代际计数,节点读取);或只为时间戳足够近的节点运行间隔;从 dep 数组去掉 `node.updatedAt`(用 ref)使手势提交不重建定时器。
- **置信度**:0.9

#### L3 · `CanvasGestureHud` 接收完整 nodes 数组,每个手势 tick 做线性 `.find`
- **文件**:`Canvas/CanvasSurface.tsx:275-282,361-378`
- **类别**:re-render
- **证据**:`{(dragPreview || resizePreview) && (<CanvasGestureHud dragPreview={dragPreview} nodes={nodes} resizePreview={resizePreview} scale={transform.scale} />)}`,内部 `const resizeNode = resizePreview ? nodes.find((n) => n.id === resizePreview.id) : null;`。传完整 live 数组(每 tick 改 identity)+ O(n) find。
- **用户影响**:每个 resize tick 加一次 O(n) 扫描。drag 无害(用 `dragPreview`),resize 付扫描。**注**:memo 化 HUD 并不能阻止每 tick 重渲染(父 `CanvasSurface` 本身非 memo 且每 resize tick 收到新 `nodes`);唯一可避成本是 O(n) `.find`。净影响相对周围全树协调微不足道。
- **修复建议**:只传所需单个节点(父中解析一次,或传 `useCanvasVisibility` 已算的 `nodesById` Map),而非整数组。
- **置信度**:0.86

#### L4 · `scheduleTerminalFit` 每个 Agent 终端 mount/restore 触发 3 rAF + 2 setTimeout(5 次 fit+refresh)
- **文件**:`AgentNodeBody/useAgentNodeController.ts:104-116`(调用方 `356,377,413,456,510,532`)
- **类别**:layout-thrash
- **证据**:`scheduleTerminalFit` 立即跑 `fitAndRefreshTerminal`,再在 rAF、嵌套双 rAF、`setTimeout(...,80)`、`setTimeout(...,240)`——5 次。每次 `fitAndRefreshTerminal` 做 `syncTerminalFontSizeToCanvas`(getComputedStyle)+ `fitAddon.fit()`(回流)+ `term.refresh(0, rows-1)`(全可见行重渲染)。
- **用户影响**:每个 Agent 终端 mount/restore 强制 5 次布局+全栅格化 pass;团队 frame 同时挂载多个 mirror 终端时倍增。**更正**:**不**随重连重试每 1s 复发(重试路径的 `scheduleTerminalFit` 被 `restoredSavedOutput` 标志 / `attachLiveMirror` 成功停定时器 守护);5 pass 跨 rAF/双 rAF/setTimeout(80/240) 分散在 ~240ms,非 5 次同步聚集回流。故 low。
- **修复建议**:收敛为单 rAF fit + 一次 trailing settle fit,去掉冗余嵌套 rAF 与两个定时器;仅当 `fit()` 真正改变 cols/rows 时才 `term.refresh()`。
- **置信度**:0.7

#### L5 · 渲染端 `onData` handler 在 coding-agent hint 激活时每 chunk 跑 ANSI-strip + tail-slice + 两个正则
- **文件**:`TerminalNodeBody/index.tsx:98-104`(`captureTerminalOutput`)→ `utils/codingAgentCommand.ts:14-21`
- **类别**:CPU 微低效(原标 layout-thrash 不准——无 DOM/回流)
- **证据**:`captureTerminalOutput` 每 `api.onData` chunk 运行,调 `appendTerminalOutputTail`(`data.replace(ANSI_PATTERN,'').replace(/\r/g,'\n')` 后 `${tail}${text}`.slice(-3000))与 `hasLikelyReturnedToShellPrompt`(`SHELL_PROMPT_PATTERNS.some(p => p.test(tail))`)。
- **用户影响**:Claude/Codex 会话运行时(最重输出态)每个重绘 chunk 付 ANSI 正则 pass + 对 3KB tail 的两次正则测,叠加 xterm 渲染。hint 只需触发一次(返回提示符),故工作几乎全浪费;成本相对 xterm 渲染小,属低影响微低效。
- **修复建议**:节流/防抖提示符检测——累积原始 chunk,最多每 ~150-250ms(或输出静默后 trailing 防抖)跑 `hasLikelyReturnedToShellPrompt`;chunk 无 ESC 字节时跳过 ANSI strip(`data.indexOf('\x1b') === -1`)。
- **置信度**:0.6

#### L6 · `highlighted` 每次悬停重算并驱动 `linkWidth/linkColor/linkDirectionalParticles` + `renderNode`
- **文件**:`WorkspaceNodes/GraphPage.tsx:364-377,767-775`
- **类别**:re-render
- **证据**:`highlighted = useMemo(() => {...}, [activeNodeId, hoverNodeId, neighbors])` 每次 `hoverNodeId` 变(每次悬停/取消)重算;`onNodeHover` 触发每悬停 React 重渲染。link 回调读它:`linkWidth/linkColor/linkDirectionalParticles`,`linkKey(link)` 每 link 每帧建 `${source}->${target}` 字符串。
- **用户影响**:**更正**:`highlighted` 重算廉价(memo 化,O(neighbors)),非问题;真实成本是 `linkWidth/linkColor` 内每 link 每帧 `linkKey()` 字符串分配(模拟热或 pan/zoom 时全 link 每帧两次分配)的 GC churn。directional particles 仅在悬停节点的邻居 link(小有界子集)。典型图尺寸 low,极密图升至 medium。
- **修复建议**:把 hover/highlight 存 ref、在回调内读(或节流 `setHoverNodeId` 到 ~rAF);在 `buildGraphData` 中为每个 link 预算稳定 key 并直接读,避免每帧重建 `linkKey`;大图禁用/限 `linkDirectionalParticles`。
- **置信度**:0.7

#### L7 · `GraphPage` 经 canvas force-graph 渲染所有节点,无节点上限/虚拟化,且每次 focus 做 O(N) 线性 find
- **文件**:`WorkspaceNodes/GraphPage.tsx:337-385`
- **类别**:layout-thrash
- **证据**:`buildGraphData`(`108-199`)对跨所有 workspace 的所有节点建 node+link map,带 tag 与 workspace-hub 扇出;`ForceGraph2D` 跑 `cooldownTime={12000}` 的 d3 模拟与逐节点 canvas 绘制。`focusNode` 做 `graphData.nodes.find((item) => getGraphId(item.id) === nodeId)`(`381`)——每次 focus 线性扫;无节点数上限。
- **用户影响**:**更正**:`focusNode` 事件驱动(仅双击 + 搜索选择,setTimeout 延迟),非每渲染/每帧,O(N) 实际可忽略。真实主导成本是 graph 开启时无上限的 d3 力模拟 + 每帧 canvas 重绘每个节点(12s cooldown)。仅影响开启实验 graph flag 且节点多的用户,故 low。
- **修复建议**:与 graphData 并行建 memo 化 `id->node` Map 使 `focusNode` O(1);对喂入模拟的节点数封顶/分页(默认限 active workspace,或超 N 时聚类/警告);降低 `cooldownTime` 或视图隐藏时暂停模拟。
- **置信度**:0.85

#### L8 · 实验视图(GraphPage / react-force-graph-2d / d3-force)在 flag 关闭时仍被 `App.tsx` 静态导入
- **文件**:`App.tsx:14-16`
- **类别**:bundle
- **证据**:`App.tsx` 顶层 `import { GraphPage } from './components/WorkspaceNodes/GraphPage'`(及 `NodeDetailPage`/`NodesPage`)。`GraphPage.tsx:11` 静态 `import ForceGraph2D from 'react-force-graph-2d'`。路由在渲染时由 `GRAPH_ENABLED`/`NODES_ENABLED`(`App.tsx:60-61,555`,默认 disabled)gate,但静态导入使 force-graph + d3 在启动 chunk 中。`{GRAPH_ENABLED && (...)}` 只影响渲染不影响打包。
- **用户影响**:**精确化**:这是从本地磁盘加载 bundle 的 Electron 桌面应用,无每用户网络"下载"成本;真实成本是更大启动 chunk + 启动时对 react-force-graph-2d 及其 d3-force 的一次性 parse/eval,即便 graph/nodes 视图 flag-disabled。故 low。
- **修复建议**:把实验视图改 `React.lazy + dynamic import` gate 在 flag 后(镜像 `chat/utils/mermaid.ts` 已用的 `import('mermaid')` 模式),则 force-graph chunk 仅在 flag 开启且路由打开时加载。
- **置信度**:0.92

#### L-Graph-Reheat / L-Focus 等图层细节已并入 H8 与 L7,不再重复。

---

### 跨维度补充(bundle / 启动,均 medium)

#### B1 · `electron.vite.config.ts` 无 `manualChunks` / build target——整个渲染端打成单个 eager parse chunk
- **文件**:`electron.vite.config.ts:111-117`
- **证据**:renderer.build 仅 `outDir: "dist/renderer"`,`plugins: [react(), localPluginRendererAssetsPlugin()]`;无 `build.rollupOptions.output.manualChunks`、无 `build.target`、无分块策略。React 树静态导入整链(`App.tsx → Workbench → Canvas → DefaultCanvasNode`),重型库(xterm、所有 `@tiptap/*`、lowlight+highlight.js、markdown-it、react-force-graph-2d 的 d3 sim)塌入 main `index` chunk。
- **用户影响**:**精确化**:Electron 渲染端从 `file://` 加载,无"下载"成本;真实成本是窗口打开时单个大 bundle 的 JS parse/compile/eval。d3-force、xterm、tiptap starter-kit + 14 扩展、lowlight、force-graph 在启动时全被 parse,即便 canvas 首绘都不需要。故 medium。
- **修复建议**:加 `build.rollupOptions.output.manualChunks` 拆 vendor 组(`vendor-graph`/`vendor-editor`/`vendor-term`/`markdown`),并配合 `React.lazy(() => import(...))` 使 Rollup 真正生成 async chunk 并延迟 eval(`manualChunks` 单独只去重不延迟 eval)。
- **置信度**:0.85

#### B2 · `DefaultCanvasNode` 把 xterm + tiptap 节点体静态导入 keep-alive canvas chunk
- **文件**:`CanvasNodeView/DefaultCanvasNode.tsx:12-19`
- **证据**:顶层静态 `import { AgentNodeBody/FileNodeBody/TerminalNodeBody/TextNodeBody }`。`TerminalNodeBody/index.tsx:3-4` 静态 `import { Terminal } from '@xterm/xterm'`、`FitAddon`;`FileNodeBody` 经 `hooks/useFileNodeEditor.ts` 静态导入 `@tiptap/starter-kit`、`extension-image`、4 个 table 扩展、`extension-code-block-lowlight` 与 `lowlight` 的 `createLowlight(common)`(拽入 highlight.js)。Canvas 在默认路由 `<PulseRouterView name='canvas' keepAlive>`(`App.tsx:513`)内,启动即挂载。
- **用户影响**:xterm 与完整 Tiptap + lowlight/highlight.js 在 canvas 可交互前被 eval,即便 workspace 零终端零文件节点。这些 dep 仅在终端/文件节点实际挂载时才需要。属 eager 模块 eval / 初始 bundle 膨胀(启动延迟),故 medium。
- **修复建议**:把各节点体改 lazy——`const TerminalNodeBody = React.lazy(() => import('../TerminalNodeBody'))`(File/Agent 同),各包 `<Suspense fallback={...}>`。节点体仅当该类型节点存在时渲染,故 xterm/tiptap chunk 按需加载。
- **置信度**:0.9

#### B3 · 窗口仅在 await 插件 setup + tools-config + welcome-workspace seeding 之后才打开(主进程)
- **文件**:`src/main/app/bootstrap.ts:106-191`
- **证据**:`app.whenReady().then(async () => {...})` 内在 `openWindow()`(`191`)前 await:`ensureWelcomeWorkspaceSeeded()`(`106`)、`applyStoredBuiltInToolsConfigToEnv()`(`135`)、`setupCanvasPlugins(BUILT_IN_MAIN_PLUGINS)`(`163`)、`reloadConfiguredExternalMainPlugins()`(`164`)。`window.ts` 创建窗口无 `show: false` + `ready-to-show` 延迟。
- **用户影响**:Time-to-window 被磁盘 I/O(workspace seeding、读 tool config)与插件激活完成 gate;任何慢插件激活或文件系统延迟直接延迟窗口出现。**精确化**:渲染端 bundle eval 成本是窗口创建**之后**顺序发生(`loadFile/loadURL` 异步),非与 pre-window await "叠加";真实成本是窗口首绘被 await 的磁盘 I/O 与(主要)慢 `activate()` 延迟。故 medium。
- **修复建议**:先开窗口(canvas shell 无需 agent registry 即可渲染),后台完成插件/tools setup,仅把 canvas-agent IPC handler gate 在就绪 promise 上;把 `ensureWelcomeWorkspaceSeeded`/`reloadConfiguredExternalMainPlugins` 移出关键路径;用 `app.whenReady()`→首绘计时确认哪些 await 主导。
- **置信度**:0.9

---

## 优先修复路线图

### P0 — 解除线性恶化的根因(高收益,中等改动)

| 修复 | 对应发现 | 预估收益 | 改动量 |
|---|---|---|---|
| **视口裁剪 `useViewportCulling`**:`transform`+容器尺寸入参,bbox 与视口(+1 视口 margin)相交,离屏节点渲染占位 div,进 margin band 才懒挂载重型 body;selected/dragging/fullscreen/边端点 始终挂载 | H1, H9 | 内存与挂载成本从 O(总节点)降到 O(屏幕节点);40 节点 workspace 初始加载与 JS 堆数量级下降 | 大(新 hook + DefaultCanvasNode 懒挂载 + 占位)|
| **`getCwd` 异步化 + 解耦 2s 自动保存**:linux 用 `fs.promises.readlink('/proc/<pid>/cwd')`(不 fork),仅 spawn/提示符返回/≤30s 读 cwd | H3 | 消除主进程每 2s fork N 子进程的同步阻塞;终端输出/打字延迟显著改善;消除单慢 lsof 冻结全应用 | 中(改 handler + 调用方缓存)|
| **`canvas:save` 单次 merge + 增量写**:`mergeExternalNodes` 调一次,缓存 `readCanvasFull`,`writeCanvasFullV2` 只写 `updatedAt` 变化节点 | H6, M-Save1 | 单节点改动从 ~5N 读 + N 写 降到 ~1 读 + 1 写;消除多终端 2s 自动保存的 IO 饱和 | 中(store/storage 改 diff 逻辑)|

### P1 — 削减拖拽/流式/keep-alive 热路径(高/中收益)

| 修复 | 对应发现 | 预估收益 | 改动量 |
|---|---|---|---|
| **drag/resize 几何排除出 `nodes` 数组**:手势中用 CSS overlay / position override map 驱动被拖节点,pointer-up 提交;`CanvasSurface` 包 `React.memo`,memo 化 visibility/render-order 输入 | H2, M2, M1, L1, L3 | 大 canvas 拖拽 jank 消除;每 tick 从 O(n) 派生流水线降到 O(被拖节点)| 大(useNodes 手势路径重构)|
| **scrollback 专用低优先级更新路径**:跳过 `pushSnapshot` 与 `resizeGroupsToChildren`;脏标志/`addon-serialize` 仅在 buffer 改变时序列化;隐藏时 gate 定时器 | H5, M3, M-Save2, M-Save3 | 消除 undo 栈污染(Ctrl+Z 正确性);消除空闲后台全 buffer 遍历 + 全 canvas 序列化 | 中 |
| **Chat 流式:`ChatMessage`/`ChatToolCalls` 包 `React.memo` + rAF 合并 delta + 流式时不跑 highlightAuto** | H7, M-Chat1, M-Chat2 | 代码密集回复流式从 O(n²) CPU 降到完成时一次 highlight;全列表每 token 重渲染消除 | 中 |
| **PTY `onData` 合并 flush(~8-16ms/帧)**:一条拼接 IPC + 每 flush 一次 observer;团队 Agent 解析复用同一 flush | M-IPC, M4 | 高吞吐输出的 IPC/主进程 CPU 压力降一个量级 | 中 |
| **keep-alive 后台静默**:LRU 限定挂载集(active + K=2-3),非 active 路由/workspace 暂停定时器与 `external-update` 订阅;`allNodes` 存 ref + 稳定 getter | H9, M-Keep1, M-Keep2, M-Keep3 | 多 workspace 会话内存停止单调增长;空闲 2s 重渲染 churn 消除 | 中-大 |

### P2 — 低成本清理与启动优化(中/低收益,小改动)

| 修复 | 对应发现 | 预估收益 | 改动量 |
|---|---|---|---|
| `resizeGroupsToChildren` 无 group 早退 | L1 | 消除零 group canvas 每 tick 浪费 Map+map | 极小(一行)|
| 相对时间提升为单共享 ticker;去 `node.updatedAt` dep | L2 | 消除每节点定时器 churn | 小 |
| ResizeObserver rAF 合并 + 尺寸不变跳过 fit | H4 | 缩放卡顿(终端在场)消除 | 小-中 |
| `execInSession` 只扫尾部 marker + 数组 append | M-Exec | 消除大输出 O(n²) 主线程阻塞 | 小 |
| mirror detach 时 `disposeSubscriptions()` | M-Mirror | 消除 ≤12 隐藏 xterm 的浪费解析 + 常驻内存 | 小 |
| 实验视图 + 节点体 `React.lazy` + `manualChunks` | B1, B2, L8 | 冷启动 parse/eval 显著下降 | 小-中 |
| 窗口先开、插件后台 setup | B3 | time-to-window 缩短 | 中 |
| Graph:`measureText` 缓存 + 缩放阈值跳 label;`tagName` 用 Map;`id->node` Map;node identity 复用 warm-start;`linkKey` 预算 | H8, M-Graph1, M-Graph2, L6, L7 | 实验 graph 大图帧率与搜索输入改善 | 中(仅 flag 用户)|
| `scheduleTerminalFit` 收敛单 rAF + trailing | L4 | 团队 frame 挂载 hitch 减少 | 小 |
| coding-agent hint 提示符检测节流 | L5 | 流式期间微 CPU 节省 | 小 |

---

## 架构级建议(跨发现的系统性模式)

1. **集中式 `nodes` 数组是最大结构性放大器**。move/resize/scrollback/cwd 自动保存全部走同一个 `updateNode → applyNodes → applyState → setNodes` 通用路径,任何变更都替换整个数组 identity,引爆下游 visibility/render-order/keep-alive 的全量重算(H2、M1、M3、L1、M-Save2、M-Keep2)。建议**分层 state**:(a) 几何/拖拽用 ephemeral override(ref/CSS),不入 canonical 数组;(b) scrollback/cwd 等"非视觉数据"走专用 patch 路径,不 push undo、不 resize group、不全 canvas 序列化;(c) canonical 数组只在结构性变更(增删/分组)时替换。

2. **缺失虚拟化是内存与挂载成本的天花板**。Canvas 与 GraphPage 都对**全集**而非**屏幕集**做挂载/渲染(H1、H9、L7)。统一引入视口裁剪 + 离屏占位 + 懒挂载重型 body,是单项收益最大的改动,且与 keep-alive 多 workspace 叠加后效果倍增。

3. **主进程 IPC 串行化使任何同步/重复 I/O 都成为全应用停顿**。`getCwd` 的 `execSync`、`canvas:save` 的 ~5N 读、`execInSession` 的 O(n²) 扫描、PTY 逐 chunk 扇出全部跑在服务所有 IPC 的同一主进程事件循环上(H3、H6、M-Exec、M-IPC、M4)。系统性原则:**主进程零同步子进程**(用 `fs.promises`/`execFile`)、**增量而非全量**(只写 diff、只扫尾部)、**合并而非逐事件**(per-id flush 窗口)。

4. **keep-alive 设计应保留状态但暂停工作**。多 workspace + PulseRouter 的 keep-alive 是有意的状态保留,但当前连后台**工作**(2s 定时器、PTY 订阅、external-update 订阅)一并保留(H9、M-Keep1/2/3)。引入贯穿 `routeActive`/`workspaceActive` 标志,隐藏时暂停定时器与订阅、保留 DOM/组件状态,并用 LRU 上限驱逐真正空闲的 workspace。

5. **流式热路径(Chat token / tool delta / PTY chunk)需要帧级合并与 memo 边界**。三处都以远高于显示需求的频率触发 setState + 全列表协调(H7、M-Chat1、M-Chat2、M-IPC)。统一模式:**rAF/帧级合并 setState** + **叶子组件 `React.memo`** + **昂贵解析(markdown/highlight/ANSI)缓存或延迟到静默**。

6. **Bundle 应按"首绘不需即懒加载"切分**。Electron 本地加载无网络下载成本,但单 eager chunk 的 parse/eval 仍是冷启动税(B1、B2、L8)。沿用仓库已有的 `import('mermaid')` 动态导入模式,把 xterm/tiptap/force-graph 等"节点/视图按需"的重型 dep 全部 `React.lazy` + `manualChunks`,并把窗口创建移出主进程插件 setup 的关键路径(B3)。

> 报告基于输入的对抗性核验发现编写,未新增任何发现。所有文件路径已按 `note` 字段的核验修正(如 `DefaultCanvasNode.tsx` 位于 `CanvasNodeView/`、`frameHierarchy.ts` 位于 `utils/`、终端成本函数位于 `AgentNodeBody/utils/terminal.ts`)。

---

## 附:完整性批判(审计盲区)

There are several node types and dimensions the audit's 9 scouted areas don't obviously cover (Iframe/webview nodes, Mermaid/Mindmap rendering, Image nodes, DynamicApp/Plugin nodes). I have enough to write the critique.

- **Iframe/webview 节点完全缺席**：`IframeNodeBody`、`DynamicAppNodeBody`、`PluginNodeBody` 各自挂载独立 `<webview>`/iframe，每个都是单独的渲染进程，多开时内存/CPU 远超 xterm/Tiptap。已有 `useWebviewBackgroundThrottle`，但其节流是否真生效、被遮挡/视口外的 webview 是否仍在跑，均未审计——这可能是最大的隐藏内存吃手。

- **Mermaid / Mindmap 渲染未覆盖**：`mermaid@11` 在 ChatMessage、RightDock、ArtifactCard、`MindmapNodeBody` 多处同步渲染，mermaid 初始化与 `render()` 是重型且常阻塞主线程；流式 chat 里每个 token 重渲是否触发 mermaid 重解析未验证。这是 chat token 流式成本之外的独立风险。

- **Image 节点与大资源**：`ImageNodeBody`/`FileNodeBody` 的图片解码、是否走 base64 内联进 canvas state（放大 read-merge-write 体积、IPC 序列化、autosave）均未测；大图内联会同时打击 `canvas:save` 与启动加载。

- **缺实测数字**：全部 39 条都是静态代码推断,没有任何 profiling——没有实际 render count（React Profiler）、没有 bundle 体积分解、没有 Electron 冷启动耗时、没有 IPC 帧率/PTY 吞吐基线。哪条是真瓶颈无法排序,需至少跑一次 production build 的 `electron-vite build` 出 chunk 体积,并用 React Profiler 抓一次典型多节点画布。

- **记忆化覆盖率存疑**：全 `components` 目录仅 3 个文件用到 `memo`/`useMemo`(且含测试文件)。"state fan-out 每次 mutation 全量重渲"这条找到了,但下游节点组件普遍未 memo 化的放大效应未量化——需要确认 `CanvasNodeView` 之下各 NodeBody 是否随无关节点 mutation 一起重渲。

- **未审计的写放大来源**：`localStorage` 被 8+ 处使用(terminal scrollback、RightDock、NodesChatDock 等),同步写 localStorage 在主线程,频繁写(如终端输出)可能造成卡顿,与 autosave 是两条独立的持久化路径,只审了 fs 侧。

- **react-force-graph-2d 仅作"渲染"提及**:其 canvas 重绘是 requestAnimationFrame 持续循环,即便图静止/不可见(切到别的 workspace 但 keep-alive 保活)是否仍在跑动画帧未验证——与 keep-alive 多挂载维度叠加可能持续烧 CPU。

- **node-pty 原生模块与 asarUnpack**:rebuild/原生绑定、PTY 后端进程数随 agent/terminal 节点线性增长的上限未探;大量并发 PTY 的 IPC 背压策略只看了流式输出,没看 resize/写入路径与进程回收。
