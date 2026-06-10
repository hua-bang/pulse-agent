# Agent Teams 成熟度 Roadmap

> Canvas Agent Teams 从"能跑"到"成熟"的目标定义与分阶段路线。
> 交互流程（创建 → Brief → 计划审批 → 执行 → Checkpoint → 完成）保持不变，演进全部发生在质量、可靠性、自治与可观测层。

## North Star（终极 Goal）

> **把一个中型真实需求（5–15 个任务）直接丢给团队后离开：8 小时内无人值守跑完；
> 交付物是一个通过了自身质量门禁、可整体 review 的变更集；
> 一次通过人工审查的概率 ≥ 70%；全程人工干预 ≤ 2 次（批计划 + 终验收）。**

三个可测要素：

| 要素 | 指标 | 含义 |
|---|---|---|
| 交付级质量 Quality | 一次通过人工审查率 ≥ 70% | "完成" = 可交付，不是"agent 说完成了" |
| 无人值守 Autonomy | 8 小时无人值守不停摆 | 中途不需要人在场救火 |
| 低干预 Friction | 人工干预 ≤ 2 次 | 人只出现在计划审批和最终验收 |

这条 North Star 同时是验收基准：每完成一个 Phase，用同一个基准任务实测一次，三个指标都达标即为"成熟"。

## 成熟度五维与当前基线

| 维度 | 已有（截至本轮重构） | 主要缺口 |
|---|---|---|
| 质量 | 验收门（teammate 完成 → Lead 核验）、handoff 交接文件强制、scope 越界检查 | 验收缺机械证据（无验证命令）；交付物是散落的文件改动，不是可 review 的变更集 |
| 可靠性 | 主进程闭环（PTY 解析 + 15s 心跳）、watchdog 两拍判死 + 自动恢复、失败依赖显式阻塞与释放、排队消息累积不丢 | 无头启动缺失（agent 拉起仍在渲染层）；PTY 文本注入的时序脆弱性未根除 |
| 自治 | 心跳驱动 Lead、节流重推、checkpoint 分轮推进 | checkpoint 强制人在场；无预算护栏（token/时长/轮次） |
| 可观测 | 事件推送（亚秒级 UI 刷新）、事件/消息全量落库 | 无运行报告、无持久度量、无成本统计 |
| 治理 | 协议权限矩阵（propose-plan / create-task / complete-team 均 Lead-only，服务端强制）、Lead 不接派发任务、Lead 行为边界 prompt 化 | dangerousMode 硬编码全开；无 worktree/分支隔离 |

## Phase 2 — 交付物级质量（让"完成" = "可交付"）

**目标：验收从"主观读 handoff"升级为"机械证据 + 主观判断"，交付物从散落改动升级为可整体 review 的变更集。**

### 2.1 任务验证命令（verify command）✅ `50ac53f`
- 计划 JSON 任务对象新增 `verify`：一条机械验证命令（如 `pnpm --filter x test`、`tsc --noEmit`、某个 lint target）。
- teammate 完成前必须自己跑通 verify（写进任务 prompt）；提交验收时，runtime 把 verify 命令与最近一次结果附进验收 prompt，Lead 复跑或抽查。
- briefing prompt 要求 Lead 为每个产代码任务声明 verify；无法机械验证的任务显式标注 `verify: manual`。

### 2.2 团队级 Git 工作流（轻量隔离，worktree 的前置台阶）
- 团队启动时在 cwd 切 `team/<name>` 分支；任务验收通过时产生一个任务粒度 commit（runtime 驱动，message 引用 taskId/handoff）。
- 验收 prompt 给 Lead 的核验材料从"git status"升级为"本任务的 diff"。
- `complete-team` 产出整体变更集摘要（diff stat + 任务→commit 对照），人终验收时看的是一个 PR 级对象。
- 跑通后再评估是否仍需要 per-teammate worktree（很可能不需要：scope 互斥 + 任务粒度 commit 已覆盖大部分冲突场景）。

### 2.3 集成验证收尾模板
- 进入 reviewing 前自动插入一个"集成验证"任务（跑全量 test/build），owner 是 teammate 而非 Lead，失败走标准打回循环。

**Phase 2 验收**：基准任务的交付物以"team 分支 + 任务 commit 序列 + 全绿 verify"形态产出；人工审查不再发现"agent 自称完成但跑不过测试"类问题。

## Phase 3 — 真正的无人值守

**目标：关着窗口从零启动并跑完一个团队；预算内全自动，超限自动停。**

### 3.1 无头启动
- agent 启动命令构建（agent 类型 → CLI 命令/参数/resume 逻辑）从渲染层抽到主进程；排队的 launch prompt 由主进程直接 spawn PTY 执行。
- 渲染层退化为纯展示（attach 到已存在的 PTY）。
- 这是"关窗即停摆"残余问题的最后一块。

### 3.2 Checkpoint 策略与预算护栏
- checkpoint 策略可配置：`manual`（现状）/ `auto-advance N 轮` / `auto-until-done`（仅失败时停）。
- 团队级预算：token / 时长 / 轮次上限，超限自动 pause 并通知人。自治的安全阀，与 3.1 配套上线。

### 3.3 协议化 agent 通道
- teammate 改为主动拉取任务（`pulse-canvas team next-task`）或经结构化通道接收，替代"往 PTY 写文本 + 120ms 回车"的注入方式；marker 正则路径正式退役。
- 根除时序脆弱性，也为未来接入非 CLI 形态的 agent 留接口。

**Phase 3 验收**：基准任务在应用启动后立即关窗，8 小时后重开，团队已在 checkpoint/完成态；全程零丢失派发。

## Phase 4 — 可观测与自我改进

**目标：每次运行产生数据，数据反哺下一次运行。**

### 4.1 运行报告
- `complete-team` 自动生成复盘 artifact：每任务耗时、打回次数、重试次数、token 消耗、handoff/verify 摘要。

### 4.2 持久度量
- 跨团队统计：一次通过率、打回率、watchdog 触发次数、人工干预次数、单位任务成本。North Star 三指标由此自动产出，"效果好没好"从体感变成曲线。

### 4.3 失败回流
- 打回原因与失败原因聚类，沉淀为 briefing prompt 的 lessons learned 段（人工审核后注入），让计划质量随运行次数提升。

**Phase 4 验收**：连续 5 次基准运行的指标可对比，且至少一条 lesson 被回流并可归因到指标改善。

## 并行工程债（不阻塞主线，择机插入）

- 三套多 agent 实现收敛（orchestrator / classic agent-teams / runtime）。
- `dangerousMode` 从硬编码改为团队创建时显式选项。
- 收件箱任务边界投递（累积排队已解决丢失，剩投递时机优化）。
- agent-teams-service 测试中泳道化（按 describe 拆文件），降低单文件膨胀。

## 排序原则

**质量 → 自治 → 观测。**
先让产出配得上无人值守（Phase 2），再放开无人值守（Phase 3），最后用数据闭环迭代（Phase 4）。颠倒顺序的后果：自治先行 = 更快地批量产出垃圾；观测先行 = 度量一个还在剧烈变动的系统。

## 基线记录（Phase 0/1，已完成）

本路线图的起点是 2026-06 的可靠性与质量重构（branch `claude/awesome-cray-ar8mkw`）：

| commit | 机制 |
|---|---|
| `51a36a3` | 验收门：teammate 完成 → needs_review → Lead accept / 打回修订 |
| `1206bf5` | handoff 交接文件强制 + 依赖上下文传路径 |
| `f825639` | scope 防护：声明文件范围、重叠不并发、验收查越界 |
| `581b172` | 主进程闭环 + watchdog + 失败依赖阻塞/释放 |
| `f028eb9` | completed 团队重开、排队累积不丢、事件推送 UI 即时刷新 |
| `3c5ee92` | Lead 不接派发任务、complete-team Lead-only |
| `f1e9af0` | create-task Lead-only（服务端强制）、回退客户端工具禁用 |
| `7ccdcb1` | Lead 行为边界 prompt 化（全局 guard + 诱惑点强化） |
| `797665f` | Phase 0/1 收口：per-team 互斥锁、store 历史封顶 + JSONL 归档、软卡死提醒、计划超限显式报错 |
