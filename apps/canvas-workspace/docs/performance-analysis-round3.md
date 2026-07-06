# Canvas Workspace 性能分析报告(第三轮)

> 第三轮 dynamic-workflow 扫描,聚焦**前两轮未覆盖的盲区维度**,与 `performance-analysis-consolidated.md` 的 67 条已确认发现**零重复**。
> - 编排:5 个并行维度分析 agent(每条候选默认 `isReal=false` 自证)+ 1 个独立对抗式验证 agent(对全部 medium 及以上候选逐条复核)。
> - 结果:21 条原始候选 → 跨维度去重 1 条 → **20 条确认**;对抗式验证 **0 条证伪、4 条降级**(降级原因均为触发频率收窄或既有守卫部分挡住,非证据造假)。
> - 前提与两轮一致:Electron 本地 `file://` 加载,无网络成本;全部为静态代码推断,零 profiling,数字为估算。
> - 扫描基线:commit `1c282e3`(P0/P1 首批修复:E1 getCwd 异步化、B3 增量跳写、F1/F2 chat markdown 缓存+流式跳过 highlightAuto、A6 早退)之后的代码。

---

## 执行摘要

第三轮在五个盲区维度(输入热路径、main 进程非终端域、媒体/CSS、生命周期泄漏、增量回归)发现 **20 条新问题**,并得到两个重要的正面结论:

1. **最重的新放大器是"每 keystroke"级触发源**:文件节点(Tiptap)每个字符同步做全文 markdown 序列化并替换整个 `nodes` 数组(I-1)——它把第一轮"集中式 nodes 数组"根因的触发频率从 drag/2s-tick 提升到了**打字频率**,是目前已知最高频的全画布重渲来源。
2. **agent 会话存储复刻了 canvas 存储的"全量而非增量"反模式**(J-1),且叠加**非原子写**的正确性风险;隐藏 keep-alive 工作区的 team 轮询在主进程冗余跑带锁 repair pass(J-2),比既有 15s heartbeat 更频繁。
3. **正面:round-2 报告之后合入的提交(MCP 连接控制、图片复制/预览等)零性能回归**;订阅/监听器纪律整体非常好(preload 统一返回 unsubscribe,ResizeObserver/Interval 清理齐全),泄漏仅剩 3 个缓慢无界 Map 与 1 个隐藏时不暂停的定时器。

## 严重程度概览

| 维度 | medium-high | medium | low-medium | low | 小计 |
|---|---|---|---|---|---|
| I. 输入与渲染热路径(非 Canvas 表面) | 1 | 0 | 6 | 0 | 7 |
| J. main 进程非终端域 | 0 | 2 | 1 | 3 | 6 |
| K. 媒体 / CSS 动画 | 0 | 1 | 0 | 3 | 4 |
| L. 生命周期 / 无界增长 | 0 | 0 | 0 | 3 | 3 |
| M. round-2 后增量回归 | 0 | 0 | 0 | 0 | 0 |
| **合计** | **1** | **3** | **7** | **9** | **20** |

> 严重度以对抗式验证 agent 的最终裁定为准(`✔` = CONFIRMED,`↓` = CONFIRMED-DOWNGRADED;low 项保留分析 agent 自证)。

---

## 维度 I:输入与渲染热路径

| ID | 严重度 | 裁定 | 标题 | 关键文件 |
|---|---|---|---|---|
| I-1 | **medium-high** | ✔ | 文件节点每 keystroke 同步 `getMarkdown`(全文序列化)+ `updateNode→setNodes` 替换整个 nodes 数组;仅磁盘写有 1500ms debounce,内存回写无任何节流 | `hooks/useFileNodeEditor.ts:276-297` |
| I-2 | medium-low | ↓ | AgentTeamFrame composer 草稿为组件 local state,每 keystroke 重渲 2243 行组件;`teamAgentNodes` 等每 render 无 memo 重算;`AgentNodeBody` 无 `React.memo` → N+1 个终端子树全量协调(重活已被 effect 门控挡住,成本为 reconciliation) | `AgentTeamFrame/index.tsx:358,1409,2164` / `AgentNodeBody/index.tsx:73` |
| I-3 | low-medium | ↓ | `getAgentDetailContext` 每 render 对选中 agent 的完整 scrollback `split('\n')` + 逐行 3 正则,无 memo(仅 inspector 打开时,每 render 一次) | `AgentTeamFrame/index.tsx:1490,164-177` |
| I-4 | low-medium | ↓ | mindmap 拖拽重排:指针落空隙时对全部 topic 循环 `getBoundingClientRect`(强制布局),`setReorder` 每 move 无条件建新对象(命中 pill 时 O(1),仅主动手势期) | `MindmapNodeBody/useMindmapController.ts:217-274` |
| I-5 | medium-low | ↓ | `TextNodeBody` 自适应 `useLayoutEffect` **无依赖数组**,每次 commit 3 次 `offset*` 强制布局读(写回有 >1px 守卫,可收敛不循环) | `TextNodeBody/index.tsx:166-182` |
| I-6 | low-medium | — | 缩放热路径 `handleWheel` 每个 ctrl+wheel 事件读容器 `getBoundingClientRect`,而容器 rect 缩放期间不变、上一 tick 的 setTransform 已弄脏布局 → 每 tick 一次可避免的强制回流 | `hooks/useCanvas.ts:62` |
| I-7 | low-medium | — | Workbench 引用剪枝 effect 依赖整个 `allNodes`:任一工作区 churn(2s scrollback / I-1 打字)都对**所有已挂载工作区全部节点**重建 id Set | `Workbench/index.tsx:135-155` |

**I 维核心修复**:I-1 把 `getMarkdown` + 内存回写合并进 150-250ms trailing debounce(或 rAF),与既有磁盘 debounce 分层;I-2 `AgentNodeBody` 包 `React.memo` + composer 草稿下沉独立子组件 + 三个裸派生值 `useMemo`;I-5 给 effect 加测量条件或改 `ResizeObserver`;I-6 缓存容器 rect;I-7 只对引用涉及的 workspace 建 Set。

## 维度 J:main 进程非终端域

| ID | 严重度 | 裁定 | 标题 | 关键文件 |
|---|---|---|---|---|
| J-1 | **medium** | ✔ | agent 会话每条消息全量 `JSON.stringify(整 session)` 直写 `current.json`:无防抖、无队列、**无 tmp+rename(非原子)**;`loadCrossWorkspaceSession` 循环逐条 `addMessage` → 同一文件 N 个重叠写(O(N²) 字节 + 写撕裂风险) | `agent/session-store.ts:95,511` / `agent/canvas-agent.ts:1118-1125` |
| J-2 | **medium** | ✔ | 隐藏 keep-alive 工作区的 team-lead(5s)/team-frame(15s)轮询无可见性门控,每 tick 主进程 `withTeamLock` 跑**mutating repair/nudge pass**(注释自证),与既有 15s heartbeat 冗余且更频繁 | `AgentNodeBody/index.tsx:125` / `AgentTeamFrame/index.tsx:886` / `agent-teams/service.ts:1730-1760` |
| J-3 | low-medium | — | agent-teams store 每 append 对**全部** events/messages `.filter` 计数 + 整份 state stringify 落盘(已有 cap/hysteresis/persistQueue/tmp-rename 缓解,experimental 门控) | `agent-teams/store.ts:178-208,260` |
| J-4 | low | — | heartbeat 每 15s 的 repair/notify 即使无状态变更也触发 `saveTeamMetadata` → 整份 state.json 重写 | `agent-teams/service.ts:1880-1932` |
| J-5 | low | — | 从 agent 输出文本推断 cwd / 任务派发时对每个路径候选同步 `statSync`(主事件循环;有界频率,experimental 门控) | `agent-teams/service.ts:193-217` |
| J-6 | low | — | 每个 agent turn 无缓存全量 `readCanvasFull` 构建 workspace summary(底层成本与 B2 缓存建议重叠,此处为新增调用点) | `agent/canvas-agent.ts:785` / `agent/context-builder.ts:434` |

**J 维核心修复**:J-1 persist 加 trailing debounce + tmp+rename 原子写 + 串行队列(参照 agent-teams store 的 persistQueue 模式),`loadCrossWorkspaceSession` 改批量赋值后单次 persist;J-2 给两个轮询加 `routeActive/workspaceActive` 门控(主进程 heartbeat 已保证推进,隐藏时可完全停),或让渲染端 snapshot 走只读路径;J-3 trim 计数改 per-team 计数器;J-4 加 dirty 标志。

## 维度 K:媒体 / CSS 动画

| ID | 严重度 | 裁定 | 标题 | 关键文件 |
|---|---|---|---|---|
| K-1 | **medium** | ✔ | 画布图片节点 `<img>` 无 `decoding="async"`/`loading`/宽高、无缩略图:原始分辨率主线程同步 decode 且解码内存常驻(4000×3000 图显示 200px 仍占 ~48MB);chat 图片同仓已是正确写法,明确不一致 | `ImageNodeBody/index.tsx:43-49` |
| K-2 | low | — | chat 未读徽点 `box-shadow` spread 无限动画(非合成)→ 有未读期间 60fps 持续 paint | `RightDock/index.css:376-431` |
| K-3 | low | — | 流式期间 `background-position` 渐变动画(非合成),离屏节点照常 tick;多流式 iframe 叠加 | `IframeNodeBody/index.css:47-87` / `artifacts/artifacts.css:72-92` |
| K-4 | low | — | `content` 属性逐步动画(每步触发 layout+paint) | `artifacts/artifacts.css:54-68` |

**K 维核心修复**:K-1 落盘时生成节点显示尺寸的缩略图 + `<img>` 补 `decoding="async"` 与宽高(与 H5 的 worker downscale 建议合并实施);K-2/K-3/K-4 改 `transform`/`opacity` 合成动画,离屏 `animation-play-state: paused`。
**正面结论**:所有 `infinite` 动画均有状态门控,空闲画布无常驻动画;IPC/preload 桥接维度经全量核查**无新增发现**。

## 维度 L:生命周期 / 无界增长

| ID | 严重度 | 标题 | 关键文件 |
|---|---|---|---|
| L-1 | low | `nodeSendQueues` 模块级 Map 只增不删(每个被发送过的 agent 节点留永久条目) | `agent/session-send.ts:44,55` |
| L-2 | low | `softStallNudgedAt` Map 只增不删(同类 Map 均有 delete,唯此遗漏) | `agent-teams/service.ts:575,2172` |
| L-3 | low | agent 节点 scrollback 自动保存 interval 隐藏时不暂停(B4/B5 的 agent-node 同构副本,另一文件路径;cleanup 本身正确) | `AgentNodeBody/useAgentNodeController.ts:886` |

**正面结论**:preload `subscribe()` 统一返回 unsubscribe 且 renderer 全部消费点在 cleanup 退订;ResizeObserver/IntersectionObserver/interval 清理齐全;有界缓存(mirrorTerminalCache=12、settledRenderCache=100)均带 LRU。除上述 3 条外**无泄漏**。

## 维度 M:round-2 之后的增量回归

**零发现。** 逐 diff 审查了 `b3488bd..HEAD` 全部非 docs 提交:MCP 面板打开只读缓存状态不做探测(引擎重连仅显式用户动作触发);图片复制走文件路径 IPC + 主进程 `nativeImage`,避开了 base64 往返;`ImageCanvasNode` 新增的 context 订阅经 useMemo 且低频。

---

## 并入总路线图的建议

- **升入 P1**:I-1(与既有 P1 项"drag/resize 几何排除出 nodes 数组"同根因同批实施,打字是比拖拽更常见的负载);J-1(含正确性风险,修复面小);J-2(与 P1 项"keep-alive 后台静默"合并实施);K-1(修复成本低、与 H5 合并)。
- **并入 P2**:I-2~I-7、J-3~J-6、K-2~K-4、L-1~L-3。

## 实测验证计划(增量)

- I-1:React Profiler 录"在大文件节点连续打字 10s",统计 `CanvasSurface` commit 次数与耗时;对比 debounce 后。
- J-1:长会话(200+ 消息)下每 turn 用 `fs` 写字节计数;`loadCrossWorkspaceSession` 期间观察重叠写(strace/dtruss 或写入计数器)。
- J-2:开一个 team 后切走工作区,主进程 `monitorEventLoopDelay` + 日志确认 5s repair pass 是否仍触发。
- K-1:多张 >10MP 图片的画布,Chrome Task Manager 观察 GPU/renderer 内存;补 `decoding=async` 前后首挂载主线程 stall 对比。

## 方法论说明

- 维度选取:以 consolidated 报告 A-H 维覆盖图取补集(输入热路径、main 非终端域、媒体/CSS、生命周期、增量回归),每 agent 强制先读 consolidated 做去重。
- 6 agent(5 分析 + 1 验证)/ 21 原始候选 → 20 确认(去重 1)/ medium+ 全部经独立对抗式复核:4 CONFIRMED、4 CONFIRMED-DOWNGRADED、0 REFUTED。
- 降级案例与前两轮教训一致:重活被 effect 依赖门控挡住(I-2)、触发条件收窄(I-3 需 inspector 打开、I-4 为主动手势)、守卫可收敛(I-5)。
- **残留盲区不变:零 profiling**,需按验证计划实测后定序。
