# Pulse Canvas Agent Plugins Market Goal

> 状态：首批产品化实现完成（2026-08-23）。本文记录产品目标与验收边界；实现事实与维护入口见 `apps/canvas-workspace/harness/knowledge/plugin-market.md`，社区供给与格式调研见 `community-agent-plugins-ecosystem-2026-08-12.md`。

## 产品目标

在 Pulse Canvas 中提供一个可检查、可安装、可撤销的 Agent Plugins 市场，让用户能够：

- 在 `/plugins` 中发现严格 Agent Plugins v1 包，并看见其 skills、MCP 与 Pulse 原生扩展能力；
- 从受控公共目录、本地目录或 Git 仓库添加插件；
- 安装可移植核心后立即使用 skills/MCP，同时单独决定是否信任并启用 Pulse 主进程或渲染器原生扩展；
- 清楚区分“可安装的 Agent Plugins v1”与“仅供发现的 Claude、Codex 或 skill collection 来源”。

市场是 Pulse 的分发与信任层，不试图把市场行为写回 Agent Plugins v1 规范。包规范回答“包里有什么”，Pulse 回答“如何发现、安装、启用和卸载”。

## 非目标

本阶段不做：

- 公共 registry、发布审核、签名、评分、支付或组织策略；
- 自动更新、依赖解析、版本冲突处理或回滚 UI；
- Claude/Codex marketplace manifest 的安装适配；这些条目当前只能 `Explore` 打开来源；
- 把 hooks、agents、commands 等客户端专属组件伪装成 Agent Plugins v1 核心；
- 让 `manifest.json` 与 `plugin.json` 混合补字段；
- 以安装动作默认授权 Pulse 主进程或渲染器原生代码。

## 信息架构与交互

`/plugins` 是独立全页路由，并与 `/skills` 通过页首 `Plugins / Skills` 标签互相切换。参考产品只提供信息架构与交互层级；视觉语言必须沿用 Pulse Canvas 既有设计系统，包括页边距、字号、色彩 token、按钮、输入框、弹窗、列表密度与侧栏关系，不复制 ChatGPT 的视觉皮肤。页面结构采用轻量桌面市场布局：

1. 页首工具栏：刷新、插件设置和 `Add` 菜单；`Add` 支持选择本地目录或输入 Git URL、ref 与仓库子目录。
2. 标题与搜索：搜索名称、描述、作者、分类和来源格式。
3. Installed strip：用紧凑图标展示已安装插件，点击进入详情。
4. `Public / Personal`：公共目录和用户自行添加的插件分开浏览；分类筛选与搜索可叠加。
5. 内容区：`Featured` 与后续分类采用双列列表；每项显示格式身份及当前操作。
6. 详情弹窗：展示来源、版本、作者、skills/MCP/Pulse extension 能力，以及安装、卸载、浏览来源或原生扩展开关。

操作语义必须稳定：

- `Install` 只出现在 Pulse 已有适配器、且包能通过校验的目录条目上；
- `Explore` 用于客户端专属或 skill collection 来源，只打开仓库，不暗示可安装；
- 安装完成不等于原生扩展已启用；有 `com.pulsecanvas` 扩展的已安装插件会显示第二个明确的启用/停用动作；
- 刷新重新读取本地目录、安装状态和内置目录快照，不代表从远程 registry 同步。

## 包格式决策

### 可移植核心：严格 Agent Plugins v1

Pulse 以根目录 `plugin.json` 为 v1 包的唯一入口：

- `$schema` 必须是 `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`；
- skills 只从 `skills/<name>/SKILL.md` 的直接子目录发现，skill frontmatter 的 `name` 必须与目录名一致；
- MCP（可选）只从根目录 `mcp.json` 读取，并使用同版本 MCP schema；
- 可移植元数据、skills 和 MCP 组成安装后可用的核心。

### Pulse 原生扩展

Pulse 专属能力放在标准扩展容器内：

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "example-plugin",
  "extensions": {
    "com.pulsecanvas": {
      "schemaVersion": 1,
      "main": { "entry": "dist/main.js" },
      "nodes": [],
      "config": []
    }
  }
}
```

`extensions["com.pulsecanvas"]` 可描述 Pulse main entry、Canvas node/renderer 和配置字段。它不是可移植 v1 核心；其他客户端可以忽略它，Pulse 也必须在用户明确授权前忽略其中的原生 main/renderer 能力。

### 唯一判定与迁移回退

包读取采用明确优先级：

1. 根目录存在 `plugin.json`：只按 Agent Plugins v1 读取；无论有效与否都不再读取 `manifest.json`。
2. 根目录不存在 `plugin.json`：才允许把旧 Canvas `manifest.json` 作为 `legacy-canvas` 迁移回退。
3. 两种 manifest 永不合并。无效 v1 包返回诊断，不能借 legacy 文件绕过校验。

Legacy 回退只为现有 Canvas 插件迁移保留，不是新插件的推荐发布格式。

## 安装、信任与安全边界

### 安装来源

- 公共目录：只有标为 `available` 的严格 v1 条目可安装；当前 Claude、Codex 与 skill collection 条目均是 source-only。
- 本地目录：保留原目录并注册为 linked/personal 插件，卸载不会删除用户源目录。
- Git：只接受无用户名/密码的 HTTPS URL；可指定安全 ref 和仓库内 subdir。仓库先克隆到临时目录、读取并校验，再按 commit SHA 复制到 Pulse 管理目录。

### 两层信任

1. **Install portable core**：用户安装后，包内 skills 与标准 MCP 会接入 Canvas Agent。MCP stdio 本身可以启动进程，因此安装仍是明确的安全决策，不能被视为纯内容导入。
2. **Enable Pulse native extension**：`com.pulsecanvas` 的 main/renderer/node 原生能力默认关闭，必须由用户在已安装插件详情中另行启用。关闭时不应进入 Canvas main/renderer registries。

通过市场安装的 v1 与 legacy 包都以 `nativeEnabled: false` 起步。为兼容既有高级设置，未被市场 state 接管的旧 Canvas 插件目录继续沿用原来的启用行为；迁移时不得误把这一兼容例外扩大到新 v1 包。

### 必须保持的防线

- manifest、skill、MCP、main、renderer、icon 与 Git subdir 的真实路径必须留在包或仓库根目录内；符号链接不能绕过 containment；
- Git ref 不能被解释为命令选项，Git 调用使用参数数组而不是 shell 字符串；
- 非 loopback 的远程 MCP 必须使用 HTTPS；仅保留公开字面量 headers，拒绝 Authorization、Cookie 与 API key 类固定凭证；
- 远程 MCP 的安装与 OAuth 连接是两个状态；未连接时不得在普通探测流程中触发动态注册；
- MCP 插件变量只允许受控的 `${PLUGIN_ROOT}` 与 `${PLUGIN_DATA}`，插件不能覆盖这两个环境变量；
- managed Git 快照必须跳过 `.git` 与 LFS smudge，拒绝链接和特殊文件，并受文件数、单文件、总大小及路径长度上限约束；
- 卸载只允许删除 Pulse 管理目录内的 Git 快照；linked 本地目录只解除注册。

## MVP 验收

MVP 完成判定：

- `/plugins` 提供参考图对应的主层级、搜索、Installed、Public/Personal、分类、详情和完整 loading/empty/error 状态；
- 首批 Exa、TranscriptAPI、Arcade、Resend、OpnForm 与 Mobbin 六个严格 v1 条目，以及本地目录和安全 Git 来源可以安装；
- v1 core、Pulse extension 和 legacy fallback 被统一归一化，但遵守 no-merge 优先级；
- 安装后的 skills 与 MCP 能被现有 Canvas Agent loaders 发现并在变更后重载；远程 MCP 在详情页明确显示并执行 `Connect`；
- Pulse main/renderer 原生能力在显式授权前不可见，启用与停用会重载相关 runtime；
- managed Git 卸载删除受控快照，linked 本地卸载不删除源文件；
- package reader、skill scan、MCP adapter、Git source validation、Canvas config 适配、市场 UI 与 IPC 合同都有自动化验证入口；
- 真实 Electron 应用在 `/plugins` 完成一次同视口视觉与交互 QA。
