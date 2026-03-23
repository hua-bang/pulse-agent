# Canvas Workspace 快捷键设计

## 目的
为 Canvas Workspace 应用设计一套跨平台、可扩展的快捷键系统，提升高频操作效率，同时不干扰文本编辑或终端输入。

## 目标
- 为高频画布操作提供键盘通道。
- 避免与编辑器、终端输入冲突。
- 提供可发现性（帮助面板 + 命令面板）。
- 支持用户覆盖和工作区级覆盖。
- 实现上尽量轻量、易扩展。

## 非目标
- 首版不提供完整的可视化快捷键编辑器。
- 不做多用户同步。
- 不深度重构编辑器或终端内部逻辑。

## 当前行为（已观察）
- 画布搜索：`Canvas.tsx` 中 Cmd/Ctrl+K 切换搜索面板。
- 文件编辑保存：`FileNodeBody.tsx` 中 Cmd/Ctrl+S 保存。
- 搜索面板导航：`SearchPalette.tsx` 中方向键/Enter/Esc。
- 右键菜单关闭：`NodeContextMenu.tsx` 中 Esc。

## 用户体验原则
- 在输入框/编辑器/终端聚焦时，不拦截常见编辑快捷键。
- 快捷键语义跨平台一致，修饰键按平台映射。
- 所有快捷键动作映射到统一命令注册表（单一事实源）。
- 提供快捷键帮助面板展示当前绑定。

## 命令与快捷键模型

### 命令注册表
集中定义命令，键盘/工具栏/命令面板共享同一命令。

命令定义（概念）：
- id: 唯一标识（例如 canvas.search, node.delete）。
- label: 展示名称（面板/帮助）。
- group: Canvas | Node | File | View | Workspace | System。
- defaultKeys: 按平台默认绑定。
- scope: global | canvas | node | editor | terminal | modal。
- when(ctx): 运行时判定条件。
- handler(ctx): 执行动作。

### 快捷键解析规则
- 统一规范化组合键字符串（如 Cmd+Shift+P）。
- 按作用域优先级解析冲突：
  modal > editor > terminal > node > canvas > global
- 只有命中命令并执行时才 preventDefault。

### 上下文判定
运行时上下文需暴露：
- activeScope: 由焦点与弹层决定。
- isEditingText: input/textarea/contentEditable 或 ProseMirror focus。
- activeNodeType: file | terminal | null。
- selectedNodeId: 当前选中节点或 null。
- isDragging: 拖拽/缩放状态。
- transform: 当前画布变换。

### 按键规范化
- macOS 使用 Cmd，Windows/Linux 使用 Ctrl（Meta 映射）。
- 规范化：
  - Cmd/Ctrl+= 放大（同时兼容 Cmd/Ctrl+Shift+"+")。
  - Shift+/ 视为 "?"。
- 不带修饰键的可打印字符在编辑/终端输入态忽略。

## 默认快捷键（Phase 1）
优先覆盖已存在能力或极易接入的动作。

动作                           | macOS            | Win/Linux       | Scope    | 说明
-------------------------------|------------------|-----------------|----------|------
打开搜索                        | Cmd+K            | Ctrl+K          | global   | 已存在
命令面板                        | Cmd+Shift+P      | Ctrl+Shift+P    | global   | 新增
切换侧边栏                      | Cmd+\            | Ctrl+\          | global   | 新增
快捷键帮助面板                  | ?                | ?               | global   | 新增
创建 Note 节点（居中）          | Shift+N          | Shift+N         | canvas   | 新增
创建 Terminal 节点（居中）      | Shift+T          | Shift+T         | canvas   | 新增
选择工具                        | V                | V               | canvas   | 新增
手型工具切换                    | H                | H               | canvas   | 新增
临时手抓（按住）                | Space            | Space           | canvas   | 新增
放大/缩小                       | Cmd+= / Cmd+-    | Ctrl+= / Ctrl+- | canvas   | 新增
重置缩放                        | Cmd+0            | Ctrl+0          | canvas   | 新增
适配所有节点                    | Shift+1          | Shift+1         | canvas   | 新增
聚焦选中节点                    | F                | F               | node     | 新增
选择下一个/上一个节点           | Tab / Shift+Tab  | Tab / Shift+Tab | canvas   | 新增
删除选中节点                    | Delete/Backspace | Delete/Backspace| node     | 新增
重命名选中节点                  | Enter or F2      | Enter or F2     | node     | 新增
打开文件                        | Cmd+O            | Ctrl+O          | editor   | 新增
保存                            | Cmd+S            | Ctrl+S          | editor   | 已存在
另存为                          | Cmd+Shift+S      | Ctrl+Shift+S    | editor   | 新增

## Phase 2（可选增强）
- 多选（Shift+Click / Cmd/Ctrl+Click）并支持组合移动。
- 对齐/分布选中节点。
- 节点连线模式（L 切换）。
- 节点折叠/展开（E）。
- 工作区切换（Cmd+Option+Left/Right）。
- 节点复制/粘贴（JSON 剪贴板）。

## UI 入口
- 快捷键帮助面板（触发：?）：分组展示 + 搜索。
- 命令面板（Cmd/Ctrl+Shift+P）：统一执行命令。
- 工具栏按钮标题提示快捷键。

## 存储与覆盖
- 全局覆盖：`canvasWorkspace.store` 存 `__shortcuts__`。
- 可选工作区覆盖：`__shortcuts__:<workspaceId>`。
- 合并顺序：default -> global override -> workspace override。

## 接入点（建议）
- 新增 hook：`apps/canvas-workspace/src/renderer/src/hooks/useShortcuts.ts`。
- 命令注册：`apps/canvas-workspace/src/renderer/src/commands/commands.ts`。
- 默认 keymap：`apps/canvas-workspace/src/renderer/src/commands/keymap.ts`。
- UI：`ShortcutHelp.tsx` + `CommandPalette.tsx`（复用 SearchPalette 样式）。
- 利用现有行为：
  - `Canvas.tsx`（搜索、聚焦、创建节点）。
  - `useCanvas.ts`（缩放、平移、重置）。
  - `useNodes.ts`（增删改节点）。
  - `FileNodeBody.tsx`（打开、保存、另存为）。

## 边界条件与风险
- 终端输入：避免截获普通字符，只允许少量全局动作。
- 输入法组合状态：composition 中不触发快捷键。
- 系统保留快捷键（Cmd+Q, Cmd+W, Alt+F4）放行。
- 键盘布局差异（非美式键盘的 +/=?）。

## 实施步骤（高层）
1) 命令注册 + 组合键规范化 + 作用域解析。
2) 快捷键接入 Canvas 和节点操作。
3) 命令面板与快捷键帮助面板。
4) 覆盖存储与合并。
5) 冲突处理与键位解析测试。

## 验收标准
- Phase 1 快捷键在 macOS 与 Windows/Linux 均可用。
- 编辑器与终端输入不被干扰。
- 命令面板和帮助面板展示完整命令与当前绑定。
- 用户覆盖能持久化且立即生效。

## 未决问题
- 快捷键默认是否按工作区隔离，还是只全局？
- 选中节点但未进入编辑时的快捷键优先级？
- 工具栏是否展示快捷键标签还是仅 tooltip？
