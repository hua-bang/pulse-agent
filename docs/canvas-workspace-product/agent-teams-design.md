# AgentTeams Canvas 设计方案

## 核心定位

AgentTeams 不是抽象 dashboard，而是画布上的**增强 Frame**。

因为当前 Coding Agent 本质是 CLI / PTY 节点，Team 不应该把终端藏起来，而是给多个 CLI Coding Agent 节点加一层编队关系。

> Agent Team = 一个画布 Frame，里面组织多个真实 CLI Coding Agent 节点。

---

## 核心对象

| 对象 | UI 层呈现 | 说明 |
|---|---|---|
| `Team` | 画布上的选中 Frame | 组织边界，提供 toolbar 和 summary |
| `TeamLead` | 可见 CLI Agent 节点 | 如 `Claude Plan`，负责 plan/delegate/summary |
| `Teammates` | 真实 CLI Agent 节点 | 如 `Claude Exec`、`Codex Exec`、`Reviewer` |
| `Tasks` | Frame 内 task queue | 展示 owner/status/blocked reason/needs input |
| `Artifacts` | 底部轻量 pills | diff、test log、note；第一版只略展示，后续展开 |
| `Human Gate` | 贴在具体 Agent 旁的 callout | 支持 approve/answer/interrupt |
| `Mailbox/EventLog` | 不作为主 UI 展示 | 底层消息总线和审计日志 |

---

## 运行机制

### 双层调度

- **TeamRuntime / Scheduler（程序层）**：持续维护 task 状态、agent 状态、空闲队列、依赖关系。检查"任务是否完成 / 谁空闲 / 谁 blocked"由 runtime 做，不烧模型 token。
- **TeamLead Agent（LLM 层）**：只在以下时机被唤醒，不常驻轮询：
  - 初始 plan
  - 有 agent 完成 task，需要决定下一步
  - task blocked / needs input
  - 用户 broadcast / 改 task
  - 所有任务完成，需要 summary
  - 有 agent 长时间 idle，且没有可分配 task
  - 有失败，需要 recovery plan

### 人类介入（Human Gate）三种触发方式

1. Agent 输出中主动请求（`[human-input-needed]`）
2. TeamLead plan 中有 approval 节点
3. 用户主动 interrupt 任意 Agent

### 父子 Agent 通信

通过 Mailbox 事件总线，不直接暴露为 UI：
- `TeamLead -> Teammate`：任务分配
- `Teammate -> TeamLead`：完成/blocked/需要输入
- `User -> Team`：Broadcast（经 Lead 路由）
- `User -> Agent`：Direct input（直接投递到 CLI session）

---

## 技术分层

### Runtime 包（`packages/agent-teams/runtime`）

纯逻辑层，不依赖 Canvas/Electron/PTY：

```
packages/agent-teams/src/runtime/
  types.ts          # 核心类型和 AgentSessionAdapter 接口（泛型）
  memory-store.ts   # 内存 Store
  team-runtime.ts   # Runtime 核心：创建 team/agent/task、分配任务、Human Gate
```

子入口：`pulse-coder-agent-teams/runtime`，通过 `packages/agent-teams/src/runtime.ts` 导出。

旧 CLI API（`Team/TeamLead`）保持不变。

### Canvas 适配层（`apps/canvas-workspace`，待实现）

```
src/main/agent-teams/
  service.ts                      # 持有 TeamRuntime 实例
  canvas-agent-session-adapter.ts # 实现 AgentSessionAdapter，映射到现有 Canvas Agent 节点
  ipc.ts                          # 暴露 renderer 调用接口
  store.ts                        # 持久化 team state

src/renderer/components/AgentTeam/
  AgentTeamFrame.tsx       # Team Frame 组件
  TaskQueueStrip.tsx       # 任务队列
  HumanGateCallout.tsx     # 人类介入点
  ArtifactStrip.tsx        # 产物轻量展示
```

`CanvasAgentSessionAdapter` 核心映射：

```ts
createSession()  -> 创建新 CLI Agent 节点
sendInput()      -> sendInputToAgentNode(agentNodeId, text)
interrupt()      -> interruptAgentNode(agentNodeId)
getStatus()      -> 读取节点当前状态
```

---

## MVP 完成标准

1. **Runtime 集成**：main process 能创建/恢复 `TeamRuntime` 实例，并持久化 team state
2. **Canvas Adapter**：`CanvasAgentSessionAdapter` 把 runtime 接口映射到现有画布 Agent 节点
3. **IPC 层**：renderer 能通过 IPC 调用 createTeam/assignTask/sendInput/interrupt/answerGate
4. **Frame UI**：画布上能渲染 `Agent Team` frame，显示 TeamLead + Teammates CLI 节点、Team toolbar
5. **Task Queue UI**：frame 内展示 task queue（owner/status/blocked reason）
6. **Human Gate UI**：某个 Agent 需要介入时，旁边出现 callout，支持文字回复和 interrupt
7. **Artifact Strip**：底部轻量展示 diff/test log/note pills

---

## 参考：Claude Code / Codex 实现模式

| 维度 | Claude Code | Codex |
|---|---|---|
| 子 agent 模型 | 独立 agent 实例，隔离上下文，只向父返回最终结果 | subagent thread，parent 汇总，approval 可从子 thread 冒泡 |
| Session | 持久化对话历史 + 工具调用，支持 continue/resume/fork | thread 级 resume/fork/goal |
| Hooks | `PreToolUse/PermissionRequest/TaskCreated/TaskCompleted/TeammateIdle` | slash 命令排队、approval 请求冒泡 |

Canvas AgentTeams 融合两者：**Claude 式 lifecycle/hooks/runtime + Codex 式 thread/subagent 可视化**。

---

## 当前状态

- [x] 产品方案收敛（画布 Frame + CLI 节点编队模型）
- [x] `packages/agent-teams/runtime` 子入口落地（tests 绿、typecheck 通过、build 成功）
- [x] `canvas-workspace` main process 适配层：`TeamRuntime`、Canvas Agent 节点 adapter、持久化 store 已接入
- [x] IPC / preload 层：create/list/snapshot/addAgent/createTask/dispatch/sendInput/interrupt/humanGate/output marker 已接入
- [x] Renderer UI：Toolbar 可创建 Agent Team Frame，Frame 内展示 agents/tasks/human gates/artifacts，并可 dispatch、补 teammate、补 task、direct input、interrupt、answer gate
- [x] Agent 输出回写：支持 `task-completed`、`task-blocked`、`human-input-needed`、`artifact` marker 回写 runtime

### 已验证

- `pnpm --filter pulse-coder-agent-teams test`
- `pnpm --filter pulse-coder-agent-teams typecheck`
- `pnpm --filter pulse-coder-agent-teams build`
- `pnpm --filter canvas-workspace test -- --run src/main/__tests__/agent-teams-service.test.ts`
- `pnpm --filter canvas-workspace typecheck`
- `pnpm --filter canvas-workspace build`
- `pnpm --filter canvas-workspace dev` 启动级 smoke：main/preload/renderer 编译并启动到 `localhost:5173`

### 后续增强

- TeamLead 自动唤醒策略目前是轻量版：任务完成后 runtime 会继续 dispatch ready tasks，但更复杂的 recovery / summary / idle 策略还可继续补 hook。
- Human Gate 已在 team frame 内贴近 agent 行展示；未来可以扩展成画布上的独立 callout 节点。
