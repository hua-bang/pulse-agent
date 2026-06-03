# 设计方案：全局可停靠 AI Chat（ChatDock）

> 目标：让 AI Chat 不再是 Canvas 的附属面板，而是一个挂在 App shell 层的**全局可停靠侧栏**，
> 在 Canvas / Nodes / Graph / 插件页等任意视图都能拉出同一个 Chat，共享同一份会话与上下文。

## 1. 背景与问题

当前 AI Chat 有**两个互相独立、且彼此互斥**的容器：

| 容器 | 位置 | 形态 | 状态来源 |
| --- | --- | --- | --- |
| `ChatPage` | `App.tsx:467` 的 `<PulseRouterView name="chat">` | 整页 `/chat` 路由 | 自带 `ChatPageBody` → `useChatComposerState` |
| `ChatPanel` | `Workbench/index.tsx:495-514` | Canvas 内右侧可调宽面板 | 每个 workspace 各挂一份 `useChatComposerState` |

两者都复用纯展示组件 `ChatView`（`components/chat/ChatView.tsx`），逻辑层是 `useChatComposerState`
（`components/chat/hooks/useChatComposerState.ts`）。

**根因**：`Nodes`（`/nodes`）和 `Graph`（`/graph`）是 `App.tsx` 里与 Canvas 同级的独立路由视图，
它们不在 `Workbench` 内部，因此拿不到 `ChatPanel`；而整页 `/chat` 又是互斥路由，进入后会盖住当前视图、
清掉 canvas 上下文（`App.tsx:64-75` 的 `activeView` 是单选）。所以：

- Nodes / Graph 看板没有任何 Chat 入口。
- Chat 的「面板形态」绑死在 Canvas，无法跨视图复用。
- 同一份会话状态在 `ChatPage` 和 `ChatPanel` 间割裂。

## 2. 目标形态（已确认）

**全局可停靠侧栏**：

- Chat 容器提升到 App shell 层，和 `SettingsDrawer` / `ArtifactDrawer` / `LinkDrawer` 同级。
- 任意视图（Canvas / Nodes / Graph / 插件页）右侧都能 toggle 出同一个 Chat。
- 只有一份会话状态，切视图不丢上下文。
- 不同视图按需向 Chat 注入各自的「上下文」（Canvas 给选中节点，Nodes 给当前筛选，Graph 给选中子图）。

## 3. 架构设计

### 3.1 组件分层（目标）

```
App (shell)
├── ChatDockProvider          ← 新增：持有全局 Chat 状态 + open/width + 上下文注册表
│   ├── AppContent
│   │   ├── Sidebar           ← 「AI Chat」按钮改为 toggle dock（而非跳整页路由）
│   │   ├── <主视图区>          ← Canvas / Nodes / Graph / 插件页
│   │   └── <ChatContextBridge>← 各视图挂载时向 provider 注册自己的 requestContext
│   └── ChatDock              ← 新增：全局停靠容器，复用 ChatView
```

### 3.2 关键改动：把会话状态提升到 shell 层

新增 `ChatDockProvider`（参照现有 `ArtifactDrawerProvider` / `AppShellProvider` 的 Context 模式）：

- 内部持有**一份** `useChatComposerState`（以 `agentScope` 为 key，scope 变化时重建订阅）。
- 暴露 `open / setOpen / width / setWidth`、`agentScope / setAgentScope`。
- 暴露一个**上下文注册表** `registerRequestContext(view, getContext)`，让当前活跃视图把
  `AgentRequestContext`（执行模式、选中节点等，见 `ChatPanel.tsx:91-101`）喂给 dock。

> 现状里 `ChatPanel` 是「每个 workspace 一份」面板状态，提升后改为「全局一份 + 当前 scope」。
> 跨 workspace 历史会话切换逻辑沿用 `ChatPage.tsx:53-64` 的 `handleSelectSession`。

### 3.3 ChatDock 容器

新建 `components/chat/ChatDock.tsx`：

- 壳沿用 Canvas 那套可调宽逻辑（`Workbench/index.tsx:398-424` 的 `handleResizeStart` 抽成共用 hook）。
- 用 `.chat-panel-wrapper` / `.chat-panel-wrapper--open` 现有 CSS（`App.css:31-42`），或新增 `.chat-dock`。
- 内部直接渲染 `ChatView`，props 来自 `ChatDockProvider` 的状态 + 当前视图注册的 `requestContext`。
- 通过 flex 布局与主视图区并排（不是 portal 覆盖），保证内容不被遮挡。

### 3.4 上下文注入（各视图各自实现）

每个视图在挂载时调用 `registerRequestContext`，卸载时反注册：

| 视图 | 注入的上下文 |
| --- | --- |
| Canvas | `scope: selected_nodes / current_canvas` + 选中节点（沿用 `ChatPanel.tsx:91-101`） |
| Nodes | 当前 workspace + 搜索/筛选条件（可后续迭代，先给最简 `current_canvas`） |
| Graph | 选中节点 / 子图（后续迭代） |
| 插件页 | 默认 `global`，无特定上下文 |

> 第一版可以只做 Canvas 注入真实上下文，其余视图先注册 `global` scope，保证 Chat 能开、能聊，
> 上下文精细化作为后续增量。

### 3.5 Sidebar 入口改动

`SidebarHeader.tsx:80-89` 的「AI Chat」按钮：

- 从 `onEnterChat`（`setLocation('/chat')`）改为 `onToggleChatDock`（toggle provider 的 `open`）。
- `--active` 态绑定 `dock.open` 而非 `activeView === 'chat'`。
- 整页 `/chat` 路由的去留二选一（见下方「开放问题」）。

## 4. 改动文件清单

**新增**

- `components/chat/ChatDockProvider.tsx` — 全局 Chat 状态 + 上下文注册表 Context。
- `components/chat/ChatDock.tsx` — 全局停靠容器（复用 `ChatView`）。
- `components/chat/hooks/useChatResize.ts` — 从 Workbench 抽出的调宽逻辑（可选）。

**修改**

- `App.tsx` — 包裹 `ChatDockProvider`，在 shell 层渲染 `<ChatDock>`；`Sidebar` 的 chat 入口改为 toggle。
- `components/Sidebar/SidebarHeader.tsx` — chat 按钮语义与 active 态。
- `components/Sidebar/index.tsx` — 透传新的 toggle / open props。
- `components/Workbench/index.tsx` — 移除内嵌 `ChatPanel`（或保留为「就地注入上下文」的桥接），改用全局 dock。
- 各视图（`NodesPage` / `GraphPage`）— 调用 `registerRequestContext`（增量）。

**保留 / 复用**

- `ChatView.tsx`、`useChatComposerState.ts`、`ChatHeader` / `ChatAnchors` / mention 相关——逻辑不动。

## 5. 分阶段落地

1. **阶段 1（MVP）**：建 `ChatDockProvider` + `ChatDock`，Sidebar 入口改 toggle，dock 默认 `global` scope。
   任意视图可开 Chat、可聊、可调宽。Canvas 内嵌 `ChatPanel` 暂时保留，二者并存验证。
2. **阶段 2**：Canvas 上下文迁移到注册表，移除内嵌 `ChatPanel`，统一为全局 dock。整页 `/chat` 决策落地。
3. **阶段 3**：Nodes / Graph 注入精细上下文（筛选条件 / 选中子图）。

## 6. 风险与注意点

- **状态提升的重建时机**：`useChatComposerState` 以 `scopeKey` 为重建边界（`ChatPage.tsx:47,86`），
  提升后要保证 scope 切换时正确重建、流式请求正确 abort。
- **mention 注册表**：`Workbench` 现有 `registerInsertMention`（`Workbench/index.tsx:187-194`）按 workspace
  注册，迁移到全局后需要按当前 scope 路由。
- **布局层级**：dock 走 flex 并排而非 portal 覆盖，避免遮挡 Graph 画布的交互层。
- **键盘快捷键**：`App.tsx:382-394` 的 `Cmd/Ctrl+Shift+L` 和 `Esc` 当前绑定整页 chat 路由，需改为 toggle dock。

## 7. 决策记录

1. **整页 `/chat` 路由：保留（决策 A）。**
   - 整页 = 「专注全屏模式」，dock = 「随手模式」，两者**共享同一份会话状态**。
   - 关键约束：`useChatComposerState` 由 `ChatDockProvider` **唯一持有**；整页 `ChatPage` 改为
     **消费** provider 的状态，而非自己再 new 一份 hook（否则两种形态又会割裂）。
   - 切换语义：dock ↔ 整页 互不清空对方；当前会话、流式状态、输入框内容在两种形态间连续。
   - Sidebar 「AI Chat」单击 = toggle dock；进入整页保留一个二级入口（如 dock header 的「全屏」按钮，
     或 `Cmd/Ctrl+Shift+L` 切整页）。`App.tsx:382-394` 的快捷键据此调整。

2. **dock 默认停靠位置**：右侧（与现有 ChatPanel 一致）。左右切换作为后续增量，不在 MVP。
3. **dock 开关跨视图记忆**：记忆。切到 Nodes/Graph 时保持上一视图的开/关与宽度。

> 决策 1 让阶段划分微调：整页 `ChatPage` 的状态迁移从「阶段 3 可选」提前到「阶段 2」，
> 与移除内嵌 `ChatPanel`、统一状态源同批完成。
