# 性能专项执行计划(本期)

> 交接文档:任务卡自包含,执行者(人或 Coding Agent)无需全局上下文即可开工。
> 体系与指标口径见 `program.md`(SSOT);发现明细见 `../docs/performance-analysis-consolidated.md`(+round3,含 file:line 与修法);操作流见 `.pulse-coder/skills/perf-report/SKILL.md`。
> 计划制定于 2026-07-04,基线 commit `4c937bb`。

## 目标与完成判据

三个 Sprint 内:
1. 六专项全部有实测数据(看板无灰色专项);
2. CI 每 PR 跑体积门禁 + 计数器场景;
3. 7 个头部发现修复且收益被基线锁定:入口体积 4,618 → ≤1,500 KB、打字整数组替换 121 → <20、拖拽 91 → <10、隐藏工作区后台 repair 归零、会话持久化 O(全量) → O(增量);
4. 看板成为团队消费入口:固定 URL 可访问最新报告、北极星趋势可见、修复收益在趋势线上可指认。

**统一工作流**(每个任务相同):改动 → 跑 `perf-report` skill 自验 → 对应告警消失/指标达标 → **同 PR 调整 `baselines.json`** → 看板即验收凭证。

---

## 进度对账(2026-07-05,commit `361e7fa`)

对照上方四条完成判据:

| 判据 | 状态 | 证据 |
|---|---|---|
| 1. 六专项全有实测 | **6/6** | AI 流式确定性回放已接入;六专项均有真实链路实测 |
| 2. CI 每 PR 跑门禁 | **已建,待绿灯确认** | perf.yml 在跑;经 4 轮修复(--no-sandbox → stderr 透出 → build:core → lazy 等待)后最新一轮结果未确认 |
| 3. 七个头部修复 | **3/5 项达标** | 入口 4618→**1329KB**(超额达成 ≤1500)✅;打字 121→**3** ✅;B5 welcome 占位 ✅;拖拽 91 ❌(B7);隐藏轮询 ❌(B3);会话持久化 ❌(B4,测量已就位) |
| 4. 看板团队消费 | **部分** | 趋势区(D1)✅、PR verdict 评论 ✅;固定 URL(D3 Pages)❌、skill 端到端(D4)❌ |

已完成任务:A1、A2、A3、A4、A5、A6、B1、B3、B4、B5、B6(含 C1-C7+chain-B 全部懒边界,六个重库 probe 全 lazy)、B7、B8、C1、D1、D2、V1。
部分完成:B2(仅 S 步)。
未动任务:C2、D3、D4、D5、D6。

**D2 完成记录(2026-07-05)**:体积 Tab 新增"Entry 依赖归因"卡片,直接读 A5 产出的 `bundle-report.json → entryDepAttribution`。**做法决策**:没有另起一套嵌套矩形 treemap(plan.md 原文写的是"嵌套矩形")——依赖数是个位数(react-dom/wouter/react/scheduler/use-sync-external-store + app 自身代码共 6 行),复用页面已有的 `.mini-bars`/`.mb-row` 横条组件(`renderChunkBars` 同款)比重新画 SVG 嵌套矩形更省代码、视觉语言也和上面的 Chunk 分布卡片保持一致;数据量大了(几十个依赖)再考虑真 treemap。**提交前自查揪出两个问题**:①最初把 app-own-code 行(`{name,kb,self}`)和 `attribution.deps` 的原始形状(`{pkg,rawKB}`)混在同一个数组里,用 `row.name ?? row.pkg` 兜底访问——改成先统一 map 成同一形状再拼数组,去掉兜底逻辑。②最初假设 `rows[0]`(app 自身代码,固定排第一)就是最大值来算条形比例——`attribution.deps` 虽是降序但 app 自身代码不参与排序,理论上某天某个依赖反超时条形会画出 100% 以外;改成 `Math.max(...rows.map(r => r.kb), 1)`。**验证方式**:无头 Chromium(`/opt/pw-browsers/chromium-1194/chrome-linux/chrome --headless --screenshot`,利用看板自身的 `location.hash` 自动切 Tab 逻辑省去脚本点击)截图两轮——第一轮发现"应用自身代码(非 node_modules)"标签被 `.mb-name` 现有的 `overflow:hidden` 截断,缩短成"应用自身代码"后二次截图确认不再截断、六行条形与 KB 数值渲染正确。674 测试全过,`perf:dashboard` 覆盖率仍 28/35(D2 是展示层,不新增/不改变已采集指标)。

**A5 完成记录(2026-07-05)**:没有引入 `rollup-plugin-visualizer` 之类的新依赖——Rollup/Vite 的插件 API 本身就在 `generateBundle` 钩子里暴露了每个 chunk 的 `modules: Record<moduleId, {renderedLength}>`(每个源文件对该 chunk 贡献的字节数,tree-shake 后、压缩前),直接用这个数据自己写了一个 ~40 行的内联插件(`entryDepStatsPlugin`,在 `electron.vite.config.ts`)按 `node_modules/<pkg>` 前缀分组求和,零新依赖、零额外构建开销。`PULSE_CANVAS_PERF_ANALYZE=1` 门控(避免正常 build 也跑这个逻辑/落盘),`report.mjs` 的构建步骤默认带上这个环境变量,所以 `perf:report` 直接就有数据,`perf:bundle` 单独跑且没设这个变量时优雅跳过(不报错)。**口径决策**:没有把每个依赖做成 `bundle.entry_dep_kb.<pkg>` 这种动态命名的标量指标塞进 metrics.json/history 棘轮体系——那套体系是为固定 ID 的基线比较设计的,依赖集合会随拆分工作变化,硬塞进去不合适。改成结构化数据放在 `bundle-report.json` 的 `entryDepAttribution` 字段,体积 Tab(D2)直接读取渲染,不进 rule engine 告警。**实测结果**(1329KB 入口的真实构成):`react-dom` 131KB、`wouter` 13KB、`react` 9KB、`scheduler` 4KB、`use-sync-external-store` 2KB——所有 node_modules 依赖加起来才 ~160KB;**app 自己的代码占了 1090KB**,是压倒性的大头。这个数据直接推翻了"继续挑 node_modules 依赖懒加载"的思路——entry 里已经没剩多少第三方库可拆了,下一刀要往 app own code 内部去看(路由级代码分割),而不是 C8 这种挑单个文件的打法。

**A4 完成记录(2026-07-05)**:`run-scenarios.mjs` 新增 `panzoomScenario`——平移用无修饰键的 wheel(app 的 `useCanvas.ts handleWheel` 把无 ctrl/meta 的 wheel delta 直接当 transform 平移量),缩放用 ctrl+wheel(CDP Input 域 modifiers 位 2 = Ctrl)。**踩了一个坑**:100 节点场景下 seed 完会自动 fit-to-view,缩放到能塞下所有节点的比例——此时随手挑的 5 个角落候选点全部踩在某个节点/webview 上,wheel 事件被节点自己的滚动/webview 内部处理"吃掉"、根本到不了画布级 handler(用真实 CDP 会话确认:同样坐标下,直接对 `.canvas-container` 原生 dispatchEvent 能让 transform 变化,但走节点覆盖的坐标就不行)。改用真正的网格扫描(`findBlankCanvasPoint`,一次 evaluate 里扫 viewport 网格找 `elementFromPoint` 不落在任何 `.canvas-node`/webview/sidebar 上的点)才稳定找到空白区。**另一个诚实的发现**:wheel/scroll 事件不在 Event Timing API 的"离散交互"集合里(规范只认 pointerdown/up、click、keydown/up 等),所以 `interactions.p95`(INP)对纯 wheel 手势**结构性恒为 0**——不是 bug,是这个指标定义本身对这类交互不适用。已经把 `interact.panzoom.inp_p95_ms` 降级为 record 级(不再是 warn)并如实写了原因,新增 `interact.panzoom.frames_over20_pct`(warn 级)作为这个场景真正有信号的指标——实测帧超率在首次手势后能稳定捕捉到非零值(受 JIT/首次布局的冷启动影响,首个 repeat 明显更高,和 typing/drag 已有的模式一致)。覆盖率 26→28/35。674 测试全过。

**B2 完成记录(2026-07-10,S+M 完成)**:`ImageNodeBody` 保留 `decoding="async"` + `loading="lazy"`,并新增主进程 `nativeImage.resize` sidecar 管线。普通画布等待 960px preview 就绪后才挂 `<img>`(不先瞬时解码原图),全屏切回原图;源路径 + size + mtime 指纹负责失效,metadata 让 cache hit 不再打开原图,旧指纹 sidecar 自动清理,生成失败回退原图。并发生成串行且每张之间让出 event loop,10 图 burst 的 main loop-delay max 从 246.7ms 降到 55.6ms。新增自包含 `image-memory` 场景与 `memory.image.decoded_mb`:10×4000×3000 原图估算 457.8MB,preview 实测 26.4MB,下降 17.4×;真实 CDP 另验证普通画布 natural size 960×720、全屏恢复 4000×3000。

**AI 流式完成记录(2026-07-10)**:新增仅在 `PULSE_CANVAS_PERF=1` 可触发的本地确定性回放,521 个 delta 走真实 IPC、`useChatStream` 和 Markdown/Mermaid 渲染链路。文本 delta 以 32ms 视觉窗口合并,流式 Markdown 全量渲染从 374 次降到 64 次(下降 82.9%),frames>20ms 从 0.7% 降到 0.3%,Mermaid tail 0.8ms;`chat-md-stream-render ≤80` 与 commit 同步设为 gate。

**指标补全记录(2026-07-10)**:dashboard 最后 3 个缺口已接通。welcome webview 由 guest `dom-ready` 上报主进程并计算开窗后耗时;AI mock turn 在 temp HOME 中走真实 `SessionStore` 持久化,稳定产生 `main.session_persist.bytes_per_turn`;新增双真实 PTY 定速流场景,统计 renderer 收到的 `pty:data` IPC/s。完整 `perf:report --repeat 3` 实测分别为 896ms、26KB/turn、181.1 IPC/s;覆盖率 40/40,门禁 11/11 通过,0 alerts。

**CDP trace 诊断补全(2026-07-10)**:复用现有 Electron harness 的动态 CDP 端口,完整报告在 100 节点业务场景之后额外执行一次明确命名的 warm renderer reload。采集 lab LCP/CLS、FCP→Canvas blocking time、Task/Script/RecalcStyle/Layout duration,并产出 `renderer-trace-summary.json` + 可由 DevTools/Perfetto 下钻的 `renderer-trace.json.gz`。核心 coverage 与 diagnostic coverage 已拆开:trace 不支持/丢数据会如实显示 unavailable/invalid,但不会伪造 0 或打红现有核心报告。MCP 只作为交互式分析层,不进入 CI 的可复现采集链。

**指标可信度补全(2026-07-10)**:对“数值为 0”逐项补齐样本契约。Pan/Zoom 不再输出结构性无样本的 wheel INP,改为每轮 50 个 wheel→next-frame 样本并同时断言 Canvas transform 已变化;交互帧窗口在动作结束的双 rAF 后冻结,同时保留 repeat 中位数、单轮最差值与慢帧计数。AI 流式通过真实节点拖拽制造 settled Markdown 重渲,单独记录 cache hits/opportunities,机会为 0 时 ratio 直接 unavailable。workspace heap 场景改为 ≥8 个等节点 workspace,只对 active+3 LRU 达容量后的尾部样本回归,并记录节点数、尾部样本数与挂载峰值;CDP/heap 失败或非正值一律报错,不再兜底成 0。warm trace 新增 Canvas→LCP blocking、Long Task count/max 与 layout-shift count/top entries,同时修正 blocking 区间为长任务 50ms 以后部分和目标窗口的真实交集。旧任务卡里的 `interact.panzoom.inp_p95_ms` 与全程 `memory.ws_cycle.heap_slope` 仅保留为历史记录,当前 SSOT 已分别由 `interact.panzoom.wheel_to_next_frame_p95_ms` 与 `memory.ws_cycle.post_capacity_heap_slope` 取代。完整 100 节点、repeat 3 实测:wheel→下一帧 0.3ms,缓存 2 hits / 4 opportunities,容量后 5 个堆样本 169.9→170.2MB(斜率 0.1MB/ws,挂载峰值 4),Canvas→LCP 阻塞 73ms,Long Task 1 次/最大 123ms;11/11 门禁、core 50/50、diagnostic 11/11。

**B4 完成记录(2026-07-05)**:`session-store.ts` 的 `persist()` 之前直接 `writeFile(currentPath, ...)`——非原子(无 tmp+rename)、多次调用互相竞态(尤其 `loadCrossWorkspaceSession` 循环对每条历史消息都调一次 `addMessage`→`persist()`,N 条消息 = N 个几乎同时的整文件写并发抢占同一路径)。参照仓库已有的 `agent-teams/store.ts` persistQueue 模式:加 `persistQueue: Promise<void>` 串行链(`writeSessionFile` 用 `${path}.${pid}.${uuid}.tmp` 唯一临时名 + `rename` 原子提交);`archiveCurrentIfExists`(被 `startSession`/`archiveSession` 调用)现在会先 `await` 这个队列再读/删 current.json,避免旧 session 的迟到写入在归档后把文件复活。`loadCrossWorkspaceSession` 循环里的 N 次 `addMessage` 改成新增的 `setMessages()` 批量赋值+单次 persist,N 次整文件写降为 1 次。**顺手做的可测试性改进**:`STORE_DIR` 从模块顶层 const(基于 `homedir()`,导入时就固定,没法 mock)改成读环境变量 `PULSE_CANVAS_SESSION_STORE_DIR` 的惰性函数——之前这个文件零测试覆盖,改完直接可以用临时目录跑真实文件系统测试,不用引入新的 mock 基建。新增 `src/main/agent/__tests__/session-store.test.ts`(3 个用例,覆盖并发 addMessage 不丢消息/无残留 tmp 文件、setMessages 单次持久化、以及归档时序不被迟到写入破坏),全部通过。`main.session_persist.bytes_per_turn` 这个指标本身仍未取得稳定实测值(需要真实 agent turn,当前沙箱没有可用的模型 API key,超出本次修复范围)。674 测试全过(baseline `session-store.ts` 561→605 行)。

**B3 完成记录(2026-07-05)**:新增 `useWorkspaceActive`(React Context,仿 `useFileNodeEditorRegistry` 的"避免逐层传 prop"模式,在 `Canvas/index.tsx` 用已有的 `isActive` prop 提供,`AgentNodeBody`/`AgentTeamFrame` 直接消费,不用改 CanvasSurface/CanvasNodeView 等 5 层中间组件)。两处轮询(`AgentNodeBody` 5s、`AgentTeamFrame` 15s)在 `!workspaceActive` 时提前 return 不建 interval,effect 依赖数组加入 `workspaceActive` 使其在可见性翻转时重新跑——隐藏时暂停、重新显示时立即触发一次刷新。新增两个永久 perf 计数器 `agent-team-lead-poll`/`agent-team-frame-poll`(复用仓库已有的 `perf/counters.ts` 机制)。**踩坑记录**:验证时先用 `window.canvasWorkspace.agentTeams.snapshot = wrapper` 猴子补丁想数调用次数,结果 contextBridge 暴露的对象是**冻结的**(`Object.isFrozen===true`),赋值静默失败——改用 `count()`(写在页面自己的世界,不经 contextBridge,不冻结)+ `window.__pulsePerf` 读取,才拿到真实数字。另外第一次拿假数据造 workspace 时用了 `'default'`(欢迎工作区 id),结果 reload 后被 `ensureWelcomeWorkspaceSeeded` 的自愈逻辑覆盖清空——后来改成专门造一个非 default 的假 workspace 才验证通过。实测:workspace 可见时 `agent-team-lead-poll` 每 5s 记 1 次;切到后台的 ~6.5s 窗口内该计数器**完全不出现**(0 次,不是被压低而是真的没调);切回来后立即又记到 1 次。671 测试全过。

**B8 完成记录(2026-07-05,用户已确认终端豁免策略)**:`useMountedWorkspaceIds.ts` 从"只增不减"改为 LRU——维护一个按最近访问排序的 recency 列表,超出 active+3 个后台 workspace 的最久未访问者会被逐出挂载集合(触发其 `<Canvas>` 卸载,连带 tiptap 编辑器/undo 历史/chat 面板一并释放)。**用户明确要求**:有活跃终端 tab 的 workspace **无条件豁免驱逐**——因为 `WorkspaceTerminalDock` 的卸载 effect 会调用 `api.kill(sessionId)` 真杀 pty 进程,不豁免会静默杀掉用户后台跑着的 `npm run dev` 之类进程。`dockState.terminalTabsByWorkspace` 从 Workbench 传入作为豁免判据。实测(A1 的 ws-cycle 场景,5 workspace 循环):堆曲线从单调上升 `[41.8→109]`(slope 14.5MB/ws)变为先升后平/回落 `[36→85.5→59.5→59.5]`(slope 3.3-3.4MB/ws,两轮验证稳定)——4 个之后不再净增长,证明驱逐生效。额外手工验证(真实 CDP 会话):挂载数在访问 6 个不同 workspace 后稳定在 4(active+3)而非 6;被驱逐 workspace 重新进入后其内容(测试用 marker 节点)正确从磁盘重新加载,无数据丢失。`memory.ws_cycle.heap_slope` 当前不是门禁项(只是 record 级指标),按程序 program.md 铁律 2(需≥5 次同机历史)暂不升级门禁等级,留给后续任务在积累历史后判断是否满足升级条件。

当前看板告警(B7 落地后连续两轮 `perf:report --repeat 3` 验证):0×medium,仅剩 2×info(拖拽帧超率近零值波动 + AI 流式无数据,均为噪声/专项性质,非真实回归)。

**B7 完成记录(2026-07-05)**:根因是 `useNodeDrag.ts` 的 `flushDragMove` 每个 pointer-move 都调用 `moveNode`/`moveNodes`,后者 `.map()` 克隆全量 nodes 数组 + 跑 `resizeGroupsToChildren`,触发 `Canvas/index.tsx` 的 `useCanvasRenderOrder` 等 O(n) 派生重算——`CanvasNodeView` 虽已 `React.memo`(按 `node` 引用比较)避免逐节点重渲染,但父级级联仍是每帧 O(n)。修法:手势期只更新一个 ephemeral `dragOffset:{dx,dy}` state(不碰 nodes 数组),`getNodeWrapperStyle(node, dragOffset)` 把偏移叠加到被拖拽节点的 transform 上;`CanvasNodeView` 的 memo 比较器新增 `dragOffset` 字段,使非拖拽节点(dragOffset 恒为 null)继续跳过重渲染,只有当前被拖节点每帧重渲染。`onDragEnd` 时才用最终位置调用一次 `moveNode`/`moveNodes` 提交真实数组;`onDragCancel`(Esc 中断)简化为纯状态清空——数组从未被动过,不需要"复原"。实测:`drag.nodes-array-replace` 91(90 步)→ **2**(3×90 步),连续两轮稳定;真实 CDP 拖拽验证(mid-drag transform 与 drop 后 transform 完全一致,无跳变);671 测试全过;baseline `drag.nodes-array-replace.max` 100→10 锁定收益(该 perf 门禁本身就是这类回归的护栏,未额外造 hook 单测基建)。

**B9/V2 完成记录(2026-07-10)**:节点调整尺寸复用 B7 的 ephemeral 思路——8 个方向的几何统一由 `computeNodeResizeGeometry` 计算,pointer-move 只更新含 `x/y/width/height` 的 `resizePreview`;节点、连接边和手势 HUD 都读取预览,mouseup 才调用一次 `resizeNode`,回到原点或 Esc 取消不写 history/save。文本节点的 `autoSize:false` 也合并进同一次 geometry commit,不会在 mousedown 提前写 history/save。新增 CDP `resize` 场景(每轮 90 moves)及 INP、帧超率、nodes-array-replace、canvas-save-ipc 四项指标;3 轮 raw 实测为 **整数组替换 [1,1,1]、保存 IPC [2,1,1]、帧超 20ms 中位数 0%**,两项 counter gate 均通过。保存计数窗口会在 begin 前排空旧 debounce、end 前等待当前保存,并拒绝任一空跑 repeat。同时修复报告可信度:每轮先清掉旧 `scenarios-report.json`,完整报告启动失败、空/损坏场景、缺 gate 配置/值或 gate 失败都 exit 1,只有显式 `--bundle-only` 可无 runtime;失败 gate 会进入 report.json 的 HIGH 告警,不再出现命令失败但看板假绿。最终 `perf:report --no-build` 为 **10/10 门禁通过、32/39 指标覆盖、仅 1 条 AI 流式未采 info**。

**A3 完成记录(2026-07-05)**:两条独立的 repeat 机制——① `report.mjs --repeat N`(默认 3)多次整机启动,仅 startup 阶段做跨启动同机中位数(`mergeStartupMedians`),清掉了 whenReady/openWindow/domReady 的波动告警;② `run-scenarios.mjs --repeat N` 在同一 session 内重跑 typing/resize/drag(计数器取 max,INP p95/frames>20% 取中位数)。`main.loop_delay_max_ms` **未**做重复稳定化——它本质是单次最坏值统计,重复整机启动的收益有限,该告警若复现,遵循规则本身的建议"重跑确认"即可。`main.canvas_save.files_written` / `main.session_persist.bytes_per_turn` 覆盖率仍不稳定(依赖 debounce 计时器是否在 session 关闭前落地),这是 c296930 引入时就有的既存偶发缺口,与本次改动无关,未在本次修复范围内。

## 第二期任务队列(交接就绪,按优先级)

> 任务卡正文在下方各 WS 节,此处只给顺序、依赖与口径变化。每张卡自包含,单个 Agent 可独立领取;**领取前先 `git fetch` 并跑一遍 `pnpm --filter canvas-workspace perf:report` 确认基线**。

**P0 · 让已建的东西可信** ✅ 两项均已完成(2026-07-05)
1. ~~**V1 · CI 绿灯确认**~~:PR #729 最新 perf.yml 运行(361e7fa)confirmed 绿灯,26/34 覆盖,8/8 门禁,非 bundle-only 退化。
2. ~~**A3 · --repeat 中位数**~~:见上方「A3 完成记录」。4 条波动 info 告警已消退,C2(record→warn)前置条件满足。

**P1 · 修复轨(收益已实测,卡片就绪)**
3. ~~**B7 · 拖拽 ephemeral**~~:见上方「B7 完成记录」。91→2,baseline 已锁定。
4. ~~**B8 · H1 LRU 驱逐**~~:见上方「B8 完成记录」。14.5→3.3-3.4 MB/ws,有活跃终端的 workspace 豁免驱逐(用户已确认)。
5. ~~**B3 · 隐藏工作区轮询门控**~~:见上方「B3 完成记录」。隐藏时轮询计数器归零,已用真实 CDP 会话验证。
6. ~~**B4 · 会话持久化队列+原子写**~~:见上方「B4 完成记录」。tmp+rename 原子写 + persistQueue 串行 + `loadCrossWorkspaceSession` 批量化,3 个新单测覆盖并发/归档时序。
7. **B2 · 图片解码/缩略图** — S+M 已完成(见上方「B2 完成记录」),后续只在积累同机历史后评估是否将 `memory.image.decoded_mb` 从 record 升级为 gate。

**P2 · 测量补全(当前字典 50 项 core + 11 项 diagnostic)**
8. ~~**A4 · pan/zoom 场景**~~ → 见下方「A4 完成记录」。
9. ~~**M1(新)· welcome webview 指标**~~:`iframe:register-webview` 在 guest `dom-ready` 二次上报 ready,main 记录开窗后耗时;真实 Electron 场景已采。
10. **M2(新)· RSS 隔离**:`memory.n100.total_rss_mb` 目前是跨窗口 run-peak(含 ws-cycle 5 workspace,c296930 已注明);把采样窗口限定到 100 节点单 workspace 段,或拆独立场景。
11. ~~**A5 · treemap 归因**~~:见下方「A5 完成记录」。**C8 评估**(i18n zh 文案是否值得 lazy):A5 数据显示入口内 app own code 高达 1090KB(远超所有 node_modules 依赖总和 ~160KB),i18n 文案只是这 1090KB 里的一小部分——C8 单独做收益有限,真正的下一刀应该是分析 app own code 内部构成(路由级代码分割),而不是挑 i18n 一个文件下手。

**P3 · 门禁升级与看板消费**
12. **C2 · record→warn**(依赖 A3 + 同机历史 ≥5 次;注意:GitHub 共享 runner 机器不同机,时间指标升级只对本地/固定自托管机历史生效,CI 上永远 record)。
13. **D3 · Pages 固定 URL**(PR 评论部分已在 perf.yml 完成,只剩主干 Pages 发布)。
14. **D6 · 规模曲线 + 修复进度视图**(依赖 A3/A4)。
15. **D4 · skill 应用内端到端**。
16. **D5 · AI 总结层**(可选,默认关,永不进门禁)。

**深水区(先要决策,勿直接开工)**
- **AI 流式专项**:确定性 mock 仅在 `PULSE_CANVAS_PERF=1` 激活,真实 IPC/UI 链路、帧超率、Markdown 渲染次数与 Mermaid tail 均已覆盖。
- `main.pty.ipc_per_sec`:ABI 已在真实 Electron 场景验证可用;双 PTY 定速输出场景已接入默认报告。
- 视口裁剪完全体:决策 #1 已出专项,不在本期。

## Sprint 划分

| Sprint | 任务 | 说明 |
|---|---|---|
| 1 | A1-A6 全部 + B1、B3、B5 + D4 | 测量轨与修复轨并行;B1/B3/B5/D4 零依赖,第一天可多线开工 |
| 2 | B2、B4、B6 + C1 + D2、D3 | B6/D2 依赖 A5;C1 依赖 A6;D3 依赖 C1 |
| 3 | B7、B8 + C2 + D1、D5、D6 | 大改动置后;C2/D1 依赖 A3 攒的历史 |

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

## WS-D 看板与报告界面(前端性能看板)

> 现状:六专项多 Tab dashboard 已由 `perf:dashboard` 从真实数据生成(规则引擎告警 + 指标证据层,`dashboard-html.mjs` 渲染,双主题)。本工作流把它从"单次快照页"演进为"团队持续消费入口"。改动集中在 `scripts/perf/dashboard*.mjs` 与 `rules.mjs`,不碰产品代码(D4/D5 除外)。

### D1 · 趋势可视化 〔S-M,依赖 A3〕
- **目标**:棘轮防退步,趋势展示进步——修复收益要在图上可指认。
- **做法**:dashboard 读 `perf/history/` 同机序列,每专项北极星画折线(SVG,复用现有调色板;冷/热启动分组两条线);数据点 hover 显示 commit,便于把拐点归因到具体 PR。≥2 点起画,不足显示现有占位。
- **验收**:总览与各专项 Tab 出现趋势区;B1 合入后打字计数器/帧超率的下降拐点在图上可见并标注 commit。

### ~~D2 · 体积 Tab treemap 归因视图〔S-M,依赖 A5〕~~ → 见上方「D2 完成记录」。

### D3 · 看板发布与托管 〔S-M,依赖 C1〕
- **目标**:团队有固定 URL 消费最新看板,不依赖本地跑。
- **做法**:CI 每次运行上传 dashboard.html + report.json 为 workflow artifact;主干构建额外发布到 GitHub Pages(或仓库 `gh-pages` 分支)保持"最新一次"固定地址;PR 运行在评论区贴 verdict + 告警摘要(report.json 直接可读,无需解析 HTML)。
- **验收**:主干合并后固定 URL 打开即最新看板;PR 上能看到 verdict 摘要评论。

### D4 · 应用内消费端到端验证 〔S,零依赖〕
- **目标**:把 `perf-report` skill 的"渲染到界面"路径在真实 Canvas Agent 会话里跑通一次(目前只验证了脚本与契约,未验证 agent 工具链)。
- **做法**:harness 启动应用 → 通过 chat 让 Canvas Agent 执行 perf-report skill → 确认 `artifact_create` + `artifact_pin_to_canvas` 成功、看板节点在画布上可交互、二次运行走 `artifact_update` 原位刷新而非新建;skill 文档按实际行为修正。
- **验收**:画布上出现可交互的性能看板节点;连续两轮运行只有一个看板 artifact。

### D5 · AI 总结层(可选增值)〔M,可选〕
- **目标**:面向人的周报式解读,叠加在确定性报告之上。
- **做法**:`perf:dashboard --ai-summary`(或 skill 内一步):把 report.json + 最近 history 喂给模型生成一段自然语言解读(对比上期、建议本迭代优先项),渲染为看板附加卡片,**显式标注"AI 生成"**;默认关闭,不参与任何门禁。
- **验收**:带 flag 运行时看板多出 AI 解读卡;不带 flag 行为与现状完全一致(确定性保持)。

### D6 · 规模曲线与修复进度视图 〔S-M,依赖 A3/A4〕
- **做法**:交互 Tab 增加"同场景 3/100/300 节点"规模曲线图(实证复杂度阶,数据来自带不同 --seed-nodes 的 repeat 运行);总览增加发现修复进度(87 条按专项的已修/待修堆叠条,数据源 metrics.json aspects.findings 结构化化)。
- **验收**:规模曲线可见且随节点数走势明确;修复进度随 WS-B 推进自动更新。

## 出专项(单独立项,不在本期)

- **视口裁剪完全体**(A1/H1 XL 改造)——决策 #1;
- chat mock 流回放 + F 维场景(先评审侵入面)、node-pty Electron ABI + 终端流式场景——原 M3 深水区,待本期收尾后评估。

## 决策记录(2026-07-04)

1. B7(拖拽 ephemeral)进专项;D3(视口裁剪)出专项单独立项。
2. I-1 debounce 默认 **200ms trailing + blur/保存 flush**;打字手感由产品验收,时长可调。
3. CI 采用 GitHub Actions(headless 配方已在无显示环境端到端验证)。
4. Sprint 切分:S1 = A1-A6 + B1/B3/B5;S2 = B2/B4/B6 + C1;S3 = B7/B8 + C2(后补充 WS-D 后修订为文首 Sprint 表,含 D1-D6 分布)。
5. 看板界面单列 WS-D 工作流;AI 总结层(D5)为可选增值、默认关闭、永不参与门禁。

## 交接材料索引

| 材料 | 位置 |
|---|---|
| 体系与指标字典(SSOT) | `perf/program.md`、`perf/metrics.json` |
| 发现明细(file:line + 修法) | `docs/performance-analysis-consolidated.md`、`-round3.md` |
| 操作手册 / Agent 操作流 | `perf/README.md`、`.pulse-coder/skills/perf-report/SKILL.md` |
| 阈值 | `perf/baselines.json`(修复必须同 PR 调整) |
| 无头环境启动 | `harness/README.md` Headless 小节、`setup:electron` |
