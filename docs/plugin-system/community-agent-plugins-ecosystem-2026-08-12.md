# Agent Plugins 社区与市场生态调研（2026-08-12）

> 2026-08-23 更新：本文主体保留 2026-08-12 的调研快照，不能再作为当前内置 catalog 的清单。当前代码已选定六个能通过严格 v1 reader 的首批包：Exa、TranscriptAPI、Arcade、Resend、OpnForm、Mobbin；以 `apps/canvas-workspace/src/main/plugin-market/catalog.ts` 为产品 SSOT。Agent Plugins 规范负责包结构，不提供公共 registry、审核或品牌资产，因此“仓库里存在 schema 合法的 `plugin.json`”不等于适合面向用户上架。后续生态判断应继续核验具体 package root、维护方、授权方式、外部依赖、许可证与真实用户价值。

## 结论

Agent Plugins 已经具备做市场的条件，但当前生态存在两层，不能混为一谈：

1. **agent-plugins.org v1 是可移植包规范，不是市场协议。** 它只标准化根目录 `plugin.json`、`skills/*/SKILL.md` 和根目录 `mcp.json`；安装、分发、权限、更新和市场 UI 明确留给客户端实现。
2. **已经活跃的“插件市场”主要是客户端市场。** Claude Code、Codex、Cursor、VS Code/GitHub Copilot 都有发现和安装机制，但市场清单、插件 manifest、支持的额外组件与安装源并不统一。
3. **严格 v1 成品已经开始成批出现，但成熟度不等于 manifest 数量。** 以精确 schema URL 发现候选、再回到上游 GitHub 源码逐包复核后，可以确认 daisyUI、n8n MCP Skills、Neon、Bernstein、AnalogJS、Coral、Context7 等都已经提交根或子目录 v1 manifest。与此同时，有些仓库只有生成前 manifest、把实际 skills 放在客户端扩展字段，或依赖未声明的 OAuth/CLI；所以“出现 v1 `plugin.json`”仍不能直接等价为 Pulse 可完整运行。
4. **Pulse 可以先集成市场，但应做多格式摄取、统一内部模型，而不是把现有市场文件当成标准。** 第一阶段最有价值的是读取 Git 仓库、本地目录及 Claude/Codex marketplace，识别并标注格式，提取可移植 skills/MCP；原生 v1 则作为首选发布格式。

**对“当前页面里的条目是不是都是官方 plugin”的直接回答：不是。** 当前内置 catalog 是 Pulse 人工整理的发现目录，不是 Agent Plugins 官方目录。8 个现有条目里，只有 `agentplugins/agent-plugins-example` 是 Agent Plugins 规范方的严格 v1 参考包；这只是当前 catalog 的状态，不代表公开生态只有它一个 v1 包。OpenAI、Anthropic、Grafana 的条目来自相应厂商官方组织，但仍是各自客户端格式或 skills 集合；Gopher AI 是项目方一手维护；PleaseAI 与 wshobson 则是社区维护。厂商官方仓库、社区主流项目和严格 Agent Plugins v1 是三个不同维度，UI 与文案不能互相替代。

## 判定口径

只有同时满足以下核心条件，本文才标记为“严格 Agent Plugins v1”：

- 插件根目录存在 `plugin.json`，且 `$schema` 为 `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`；
- skills 固定在 `skills/<name>/SKILL.md` 的直接子目录；
- MCP（如有）固定在根目录 `mcp.json`，使用同版本 schema；
- hooks、agents、commands 等非 v1 组件不能作为未命名的可移植核心字段，只能由客户端扩展处理。

依据：[Agent Plugins v1 规范](https://agent-plugins.org/specification)、[兼容客户端清单](https://agent-plugins.org/compatible-clients)、[官方参考包](https://github.com/agentplugins/agent-plugins-example)。规范当前版本是 1.0.0，状态仍是 Working Draft，并明确说明 distribution、installation、enablement、updates 和 UI 不属于规范范围。

## 严格 v1 候选：Pulse 低改造清单

本节回答“哪些公开内容最符合 Agent Plugins v1，而且 Pulse 不需要过分修改”。发现阶段可以借助代码索引，但下面每一项结论都重新核对了上游 GitHub 的 `plugin.json`、固定目录、MCP、实际 skill 内容和许可证；链接固定在 2026-08-12 核验到的 commit，避免默认分支后续变化覆盖证据。

分级只描述 **Pulse 当前实现的接入成本**，不是上游项目质量排名：

- **A — 当前可直接安装**：现有 reader 能得到有效的 portable component，且不需要 Pulse 专属 wrapper、OAuth 推断或客户端 hooks；用户项目本身的依赖仍按 skill 指引处理。
- **B — 包不用改，只需 catalog `subdir`、通用 parser/auth 修正或外部命令预检**：改动是一次性的客户端能力，不应 fork 上游包。
- **C — 不建议放入首批 Install**：源码目录会安装成空包，或主要能力依赖 v1 之外的 hooks/agents/生成步骤；在物化 adapter 完成前只适合 Explore。

### A：当前 reader 可直接安装

| 候选 | 源码核验 | 客户端专属依赖 | 许可证与维护信号 | 结论 |
|---|---|---|---|---|
| **daisyUI** | 根 [`plugin.json`](https://github.com/saadeghi/daisyui/blob/42b09e637e09467aa54a813a5aea53c1179aec75/plugin.json) 声明 v1；固定目录 [`skills/daisyui/SKILL.md`](https://github.com/saadeghi/daisyui/blob/42b09e637e09467aa54a813a5aea53c1179aec75/skills/daisyui/SKILL.md) 的 `name` 与目录一致，安装/配置/颜色/组件资料都在该 skill 子树；无 `mcp.json`。 | 无 Claude/Codex 专属执行要求；内容是 daisyUI/Tailwind 规则与本地参考文件。 | manifest 标 MIT、版本 `5.7.0`，由 daisyUI 上游仓库直接维护。 | **A，首批最稳的业务插件。** catalog 直接指向仓库根即可。 |
| **Agentic Essentials** | 子目录 [`plugins/agentic-bundle-essentials/plugin.json`](https://github.com/sickn33/antigravity-awesome-skills/blob/9e4b5fa51fef6323170a81d66ec5cbb9c951192e/plugins/agentic-bundle-essentials/plugin.json) 声明 v1，并在固定 `skills/` 下提供 concise planning、git pushing、lint/validate、systematic debugging、TDD 5 个直接 skill；目录名与 frontmatter `name` 逐项一致，无 MCP。 | 只需 catalog `subdir`，不依赖 Claude/Codex extension。部分 skill 会指导 agent 执行 Git、lint 或脚本，仍应经过普通安装确认与工具权限边界。 | manifest 标 MIT、版本 `15.12.0`；社区仓库核验时约 39.2k stars，供给规模强，但不等于规范方或厂商官方。 | **A，适合作为 Community 首批；不应默认预装。** |
| **Agent Plugins Example** | 规范方根 [`plugin.json`](https://github.com/agentplugins/agent-plugins-example/blob/main/plugin.json) 与 `skills/migrate-agent-plugin/SKILL.md` 已被现有 Pulse reader 用作参考样本。 | 无。 | 规范方 canonical example。 | **A，但只放 Developer / Reference，不冒充生产热门能力。** |

### B：保持上游包不变，做很薄的客户端适配

| 候选 | v1 与可用内容 | Pulse 当前差距 / 前置条件 | 许可证与维护信号 | 建议 |
|---|---|---|---|---|
| **AnalogJS** | [`packages/platform/plugin.json`](https://github.com/analogjs/analog/blob/4784ab06e50472b7568495587d538848dc552e8e/packages/platform/plugin.json) 是严格 v1；[`skills/analogjs/SKILL.md`](https://github.com/analogjs/analog/blob/4784ab06e50472b7568495587d538848dc552e8e/packages/platform/skills/analogjs/SKILL.md) 是纯框架约定，无 MCP。 | **只需 catalog** `subdir: packages/platform`；Pulse 已有受 containment 检查的 Git `subdir` 支持，不需要改 reader。 | manifest 标 MIT；同目录有 [`plugin.spec.ts`](https://github.com/analogjs/analog/blob/4784ab06e50472b7568495587d538848dc552e8e/packages/platform/plugin.spec.ts)，由 AnalogJS 主仓维护。 | **B 中最高优先级，实际风险接近 A。** |
| **Agent Rules** | 根 [`plugin.json`](https://github.com/netresearch/agent-rules-skill/blob/2727699f8023a80a7757e37e8e81f1704d66e6da/plugin.json) 是严格 v1；固定 [`skills/agent-rules/SKILL.md`](https://github.com/netresearch/agent-rules-skill/blob/2727699f8023a80a7757e37e8e81f1704d66e6da/skills/agent-rules/SKILL.md) 携带生成、校验和维护 AGENTS.md 等规则文件的 scripts/references。当前 Pulse reader 实测得到 1 skill、0 diagnostics。 | 包本身无需 wrapper；完整脚本流程声明依赖 Bash 4.3+、jq 1.7+、Git，因此安装前应做命令 preflight，尤其不能假设 macOS 系统 Bash 版本满足。 | manifest 标 `(MIT AND CC-BY-SA-4.0)`、版本 `3.14.0`，由 Netresearch 维护。 | **B，适合作为 Developer Tools；依赖齐全时可直接工作。** |
| **Jira Skill** | 根 [`plugin.json`](https://github.com/netresearch/jira-skill/blob/9cbcb9f2d92fc014c9b040e22a6cf00f1f7fd422/plugin.json) 是严格 v1；固定目录提供 [`jira-communication`](https://github.com/netresearch/jira-skill/blob/9cbcb9f2d92fc014c9b040e22a6cf00f1f7fd422/skills/jira-communication/SKILL.md) 与 [`jira-syntax`](https://github.com/netresearch/jira-skill/blob/9cbcb9f2d92fc014c9b040e22a6cf00f1f7fd422/skills/jira-syntax/SKILL.md)，当前 Pulse reader 实测 2 skills、0 diagnostics。 | 无 MCP/客户端 extension 适配；执行 Jira 操作需要 Python 3.10+、`uv`、实例 URL 与用户凭据，安装页应显示 Setup/prerequisite，不把缺少凭据当成包损坏。 | manifest 标 `(MIT AND CC-BY-SA-4.0)`、版本 `3.25.0`，由 Netresearch 维护。 | **B，适合作为 Productivity 样本；环境配置后无需改包。** |
| **n8n MCP Skills** | 根 [`plugin.json`](https://github.com/czlonkowski/n8n-skills/blob/67dbc8f4fe1db20497954b4ba0107062dda434d8/plugin.json)、严格 [`mcp.json`](https://github.com/czlonkowski/n8n-skills/blob/67dbc8f4fe1db20497954b4ba0107062dda434d8/mcp.json)，以及 [`skills/`](https://github.com/czlonkowski/n8n-skills/tree/67dbc8f4fe1db20497954b4ba0107062dda434d8/skills) 下 14 个专项 skill + 1 个 router；所有顶层 skill 名称与目录匹配，单行 description 均未超过 Pulse 的 1024 字符限制。 | 上游明确说明 Agent Plugin 客户端没有 Claude hooks 时会降级为靠 skill description 路由，因此 hooks 不是硬依赖；但托管 `https://api.n8n-mcp.com/mcp` 首次使用走 OAuth，而 Pulse 的 v1 MCP adapter 当前只写 URL、不会从 401 自动推断 `auth: oauth`。 | manifest 标 MIT、版本 `1.29.0`；仓库带 evaluations、安装/开发文档并持续维护。 | **先以 Skills 可用、MCP 待连接展示；补一次通用 OAuth discovery 后转 A。** |
| **Bernstein** | 根 [`plugin.json`](https://github.com/sipyourdrink-ltd/bernstein/blob/8a15bbbd11f77b1b90f2d97dc323834e62cdd8f9/plugin.json)、[`mcp.json`](https://github.com/sipyourdrink-ltd/bernstein/blob/8a15bbbd11f77b1b90f2d97dc323834e62cdd8f9/mcp.json) 和 [`skills/bernstein-run/SKILL.md`](https://github.com/sipyourdrink-ltd/bernstein/blob/8a15bbbd11f77b1b90f2d97dc323834e62cdd8f9/skills/bernstein-run/SKILL.md) 都在固定位置；MCP 是 `uv run bernstein mcp`、cwd 为 `${PLUGIN_ROOT}`。 | 上游 skill 的 description 使用合法 YAML folded scalar `>`；Pulse 当前轻量 frontmatter parser 会把它判无效，需要改成真正的 YAML 解析或补 block-scalar 支持。运行还需机器上有 `uv`，适合安装前 preflight。 | manifest 标 Apache-2.0、版本 `3.14.159`；[`README`](https://github.com/sipyourdrink-ltd/bernstein/blob/8a15bbbd11f77b1b90f2d97dc323834e62cdd8f9/README.md) 明确标 beta / solo-maintained，并公开 CI、CodeQL 与安装前提。 | **修通通用 YAML frontmatter 后可纳入；市场上要显示 Beta 与 `uv` prerequisite。** |
| **Coral** | [`plugins/coral/plugin.json`](https://github.com/withcoral/coral/blob/3c2e7c73933da78340dcb602ceb37dad24401608/plugins/coral/plugin.json) 是 v1，并合法使用 `extensions["com.openai"]`；严格 [`mcp.json`](https://github.com/withcoral/coral/blob/3c2e7c73933da78340dcb602ceb37dad24401608/plugins/coral/mcp.json) 加 3 个直接 [`skills/`](https://github.com/withcoral/coral/tree/3c2e7c73933da78340dcb602ceb37dad24401608/plugins/coral/skills)。 | catalog 设置 `subdir: plugins/coral`；MCP 命令是裸 `coral mcp-stdio`，现有 adapter 能表达，但包不携带二进制，必须 preflight 已安装并完成 Coral 连接。`com.openai` UI 元数据可安全忽略。 | manifest 标 Apache-2.0、版本 `0.3.0`，由 Coral 主仓维护，并同时保留 v1/Codex/app 入口。 | **适合作为“严格包 + 外部 CLI”样本；没有 `coral` 时按钮应显示 Setup，不直接报运行失败。** |
| **Context7** | [`plugins/agent-plugins/context7/plugin.json`](https://github.com/upstash/context7/blob/895c5c399752109be3bd78fa5f0c2e1f5b5a1420/plugins/agent-plugins/context7/plugin.json)、严格 [`mcp.json`](https://github.com/upstash/context7/blob/895c5c399752109be3bd78fa5f0c2e1f5b5a1420/plugins/agent-plugins/context7/mcp.json) 和直接 [`skills/context7-mcp/SKILL.md`](https://github.com/upstash/context7/blob/895c5c399752109be3bd78fa5f0c2e1f5b5a1420/plugins/agent-plugins/context7/skills/context7-mcp/SKILL.md) 完整；上游 README 还逐项说明为何 v1 不把命令、agents、固定密钥带进 portable core。 | catalog 只需 `subdir: plugins/agent-plugins/context7`；远程 MCP URL 明确使用 OAuth 2.1 动态注册/PKCE，Pulse 要先完成通用 401 discovery → OAuth provider 映射。 | manifest 标 MIT、版本 `1.0.0`；同仓维护 Agent Plugins、Codex、Claude、Cursor、Copilot 多种入口，v1 包不是第三方转换物。 | **OAuth bridge 完成后是非常合适的 Featured 候选；此前可安装 skill，但 MCP 状态必须显示“需要连接”。** |
| **Neon Postgres** | 根 [`plugin.json`](https://github.com/neondatabase/agent-skills/blob/329882a358f05b7b1b24d64f56dc3b6d3a454f54/plugin.json)、严格 [`mcp.json`](https://github.com/neondatabase/agent-skills/blob/329882a358f05b7b1b24d64f56dc3b6d3a454f54/mcp.json) 和 8 个直接 [`skills/`](https://github.com/neondatabase/agent-skills/tree/329882a358f05b7b1b24d64f56dc3b6d3a454f54/skills)，由 Neon 官方组织发布。 | 远程 `https://mcp.neon.tech/mcp` 需要用户账户授权；另外 router skill 使用 `description: >-`，Pulse 当前 parser 会把 `>-` 当成字面 description 而不是折叠 YAML。应与 Bernstein 一起修通 YAML，再接通 OAuth。 | manifest 标 Apache-2.0、版本 `1.1.1`；官方仓库同时发布 Neon CLI/MCP/skills 的使用说明。 | **是高价值官方供给，但应在 YAML + OAuth 两个通用修正后进入首批 Install。** |
| **Google Cloud DB Context Engineering** | [`plugin/plugin.json`](https://github.com/GoogleCloudPlatform/db-context-enrichment/blob/9736754fc61001c55e85ef0eb31deccce57e5002/plugin/plugin.json)、严格 [`mcp.json`](https://github.com/GoogleCloudPlatform/db-context-enrichment/blob/9736754fc61001c55e85ef0eb31deccce57e5002/plugin/mcp.json) 与 7 个直接 [`skills/`](https://github.com/GoogleCloudPlatform/db-context-enrichment/tree/9736754fc61001c55e85ef0eb31deccce57e5002/plugin/skills)；两个 MCP server 都使用 `uvx`。 | catalog 设置 `subdir: plugin`，并 preflight `uvx`。其中 Toolbox 参数引用工作区运行时生成的 `autoctx/tools.yaml`；Pulse 当前把无显式 cwd 的 stdio server 默认运行在插件根，需要先做一个真实安装烟测，确认 cwd/data 写入约定，不能仅凭 schema 上架。 | manifest 标 Apache-2.0、版本 `0.7.2`；由 GoogleCloudPlatform 组织主仓发布。 | **可作为第二批厂商样本；完成 cwd 烟测前不要标 One-click。** |

### C：manifest 命中 v1，但不适合首批直装

| 候选 | 为什么不是低改造 Install | 许可证与维护信号 | 当前处理 |
|---|---|---|---|
| **Remotion** | [`packages/codex-plugin/plugin.json`](https://github.com/remotion-dev/remotion/blob/ec1d45e41d1ad554758430a9bdc2f53a1c270c93/packages/codex-plugin/plugin.json) 是 v1，但源码子目录没有固定 `skills/`；[`build.mts`](https://github.com/remotion-dev/remotion/blob/ec1d45e41d1ad554758430a9bdc2f53a1c270c93/packages/codex-plugin/build.mts) 会从兄弟 package 复制 skills，再注入 Codex/Cursor 差异。Pulse 直接克隆该 subdir 会读到 manifest、却得到 0 个 component。 | manifest 与子目录 LICENSE 均为 MIT；上游有 build/test，但当前 Git 目录是生成源，不是发布物。 | **Explore；以后支持 release artifact/npm 物化包，或在 catalog 固定构建产物，不能安装时现场跑任意 build。** |
| **GitHub Awesome Copilot 聚合插件**（以 testing-automation 为例） | [`plugin.json`](https://github.com/github/awesome-copilot/blob/35b7b9b0ece5ef92fd0f4c91944f56be9ab8b675/plugins/testing-automation/plugin.json) 声明 v1，但该 package 子目录只有 manifest/README；5 个 skills 和 4 个 agents 只在 `extensions["com.github.awesome-copilot"]` 中引用仓库其他位置，固定 `skills/<name>/SKILL.md` 不存在。Pulse 会忽略未知扩展并安装成空包。 | manifest 标 MIT；由 GitHub 的 awesome-copilot 社区主仓持续生成大量聚合包。 | **Explore；需要“按扩展清单物化 package”的 GitHub 专用 adapter 后再 Install，不能把 exact schema 当作完整 portable core。** |
| **LangWatch** | [`plugins/langwatch/plugin.json`](https://github.com/langwatch/langwatch/blob/c67dd2877915af7793c105f9c17028ef14c12a7e/plugins/langwatch/plugin.json) 与 [`skills/langwatch/SKILL.md`](https://github.com/langwatch/langwatch/blob/c67dd2877915af7793c105f9c17028ef14c12a7e/plugins/langwatch/skills/langwatch/SKILL.md) 可读，但“自动记录 coding-agent session”的核心来自非 v1 [`hooks/hooks.json`](https://github.com/langwatch/langwatch/blob/c67dd2877915af7793c105f9c17028ef14c12a7e/plugins/langwatch/hooks/hooks.json) 和构建生成的 session script；Pulse 只加载 skill 后不会采集 session，查询还要求 `langwatch` CLI 登录。 | manifest 标 MIT、版本 `1.0.0`；同目录有 changelog、build 与 manifest/hook tests，维护信号好，但 portable core 与产品描述不完整对应。 | **Explore；等 Pulse 有命名 hooks extension 或把 catalog 文案降级为“读取已有 traces 的 CLI skill”再上架。** |

### 对首批 catalog 的直接建议

1. 立即加入 **daisyUI（A）**、**Agentic Essentials（A，Community）** 和 **AnalogJS（B，仅 subdir）**；它们能验证纯 skill 插件的真实用户价值，不引入 auth 或本地 server 风险。Agent Rules 与 Jira 可一并进入 catalog，但安装详情要先展示外部命令/凭据前置条件。
2. 下一步只做两项通用能力：**标准 YAML frontmatter 解析** 与 **远程 MCP 401/OAuth discovery**。完成后可同时解锁 n8n、Bernstein、Context7、Neon，而不是为每个包写 wrapper。
3. 再加入 **Coral** 作为 stdio 外部 CLI 样本；安装页必须把 `coral`/`uv`/`uvx` 等 prerequisite 与 OAuth 状态做成结构化状态，不要等首次 tool call 才失败。
4. Remotion、Awesome Copilot 聚合包、LangWatch 先留在 Explore。三者都需要物化或 hooks 能力，若为了凑数量直接标 Install，会让市场出现“安装成功但没有能力”的假阳性。

## 当前 Pulse 内置 catalog 逐项核验

下表逐项对应 `apps/canvas-workspace/src/main/plugin-market/catalog.ts`。这里的 **Install / Explore 是 Pulse 当前摄取能力**：严格 v1 可以由现有 reader 直接校验和安装；Claude、Codex、多客户端市场或 skills collection 尚无显式适配器，所以只打开上游来源。`Explore` 不表示项目在其原生客户端中不可安装。

| Pulse 条目 | 一手来源与维护身份 | 严格 Agent Plugins v1？ | 当前为何 Install / Explore | 主流依据与保留建议 |
|---|---|---|---|---|
| Agent Plugins Example | [`agentplugins/agent-plugins-example`](https://github.com/agentplugins/agent-plugins-example) 自述为 v1 canonical example；根 [`plugin.json`](https://github.com/agentplugins/agent-plugins-example/blob/main/plugin.json) 声明 v1 schema。维护身份：**规范方参考包**，不是业务厂商插件。 | **是。** 根 manifest、`skills/migrate-agent-plugin/SKILL.md` 与 v1 固定布局齐全。它是参考/迁移包，不应宣传为生产能力插件。 | **Install**：当前 catalog 中唯一标为 `sourceFormat: agent-plugin` 且可被严格 v1 reader 直接安装的条目。 | **保留，但定位为 Developer / Reference。** 价值是协议验收、迁移示范和安装链路冒烟，不是用户侧“热门插件”。 |
| OpenAI Role-Specific Plugins（Pulse 当前显示 OpenAI Role Plugins） | OpenAI 官方组织的 [`openai/role-specific-plugins`](https://github.com/openai/role-specific-plugins) 当前提供 Sales、Data Analytics、Product Design 三类角色。README 明确布局为 `.agents/plugins/marketplace.json` + 各包 `.codex-plugin/plugin.json`，并称其为需定制的 Codex templates。维护身份：**厂商官方（OpenAI）**。 | **否。** 是 Codex marketplace / manifest，不是根 v1 manifest；部分 connector id 还是待替换占位符。 | **Explore**：Pulse 尚未摄取 Codex marketplace、`.codex-plugin` 与 `.app.json`。 | **保留，并标注 Official by OpenAI / Codex。** 截至核验日仓库约 490 stars、78 forks；官方性和工作流代表性足够。Pulse catalog 后续应同步 canonical 仓库名、URL 与三个现有角色。 |
| Anthropic Skills | Anthropic 官方 [`anthropics/skills`](https://github.com/anthropics/skills) 明确称其为 Claude 的 skills 实现；其 [Claude marketplace](https://github.com/anthropics/skills/blob/main/.claude-plugin/marketplace.json) 将 `document-skills`、`example-skills` 等声明为 `strict: false` skills bundles。维护身份：**厂商官方（Anthropic）**。 | **否。** 仓库根没有 v1 `plugin.json`；这是 skills collection 加 Claude marketplace 包装。 | **Explore**：Pulse 当前不把整仓 skills collection 当作一个严格 v1 插件安装，避免丢失 bundle 边界或伪造 manifest。 | **保留，并标注 Official by Anthropic / Skills collection。** 截至核验日约 168k stars、20k forks，属于明确主流的一手供给；后续适合加 skills-collection adapter。 |
| Claude Code Plugins | Anthropic 官方 [`anthropics/claude-code`](https://github.com/anthropics/claude-code) README 明确说明仓库内含扩展 custom commands 与 agents 的 Claude Code plugins；目录入口是 [`.claude-plugin/marketplace.json`](https://github.com/anthropics/claude-code/blob/main/.claude-plugin/marketplace.json)。维护身份：**厂商官方（Anthropic）**。 | **否。** 采用 Claude marketplace 与 `.claude-plugin/plugin.json`，能力还包含 commands/agents，不是 v1 portable core。 | **Explore**：Pulse 尚无 Claude marketplace/manifest adapter，不能安全地只挑部分组件后宣称完成安装。 | **保留，并标注 Official by Anthropic / Claude Code。** 宿主仓库截至核验日约 141k stars、22.7k forks，主流性很强；但数字代表 Claude Code 项目整体，不应冒充某个插件的安装量。 |
| Cross-client Dev Plugins | [`pleaseai/claude-code-plugins`](https://github.com/pleaseai/claude-code-plugins) README 说明由 Passion Factory 维护，Claude manifest 是 SSOT，Codex 与 Antigravity manifest 自动生成。维护身份：**社区/第三方维护**。 | **否。** 即使 Antigravity 产物也叫根 `plugin.json`，上游明确它是从 Claude manifest 生成的客户端产物，不能仅凭文件名判为 agent-plugins.org v1。 | **Explore**：整仓是 marketplace，不是单个 v1 包；Pulse 还未实现 marketplace 展开、单插件选择和三格式校验。 | **保留为多格式适配样本，不标“主流/官方”。** 上游覆盖大量框架与三种 runtime，但截至核验日约 12 stars、2 forks；其主要价值是格式转换工程样本。 |
| Agents & Skills Library | [`wshobson/agents`](https://github.com/wshobson/agents) 自述为 multi-harness community marketplace，提供 94 plugins、203 agents、175 skills、109 commands，并提交 Claude、Codex、Cursor 等原生 registry。维护身份：**社区维护**。 | **否。** 上游明确为“一份内容、各 harness 原生 artifact”，Codex 仍使用 `.agents/plugins/marketplace.json` + `.codex-plugin/plugin.json`，不是 v1 单包。 | **Explore**：Pulse 当前没有多 marketplace 展开与逐包适配，直接克隆整仓也不能当作一个插件安装。 | **保留，标注 Community / Multi-harness。** 截至核验日约 38.7k stars、4.1k forks、530 commits，且内容规模公开可核验，是当前 catalog 中最有依据的社区主流样本。 |
| Grafana AI Marketplace | Grafana 官方组织的 [`grafana/ai-marketplace`](https://github.com/grafana/ai-marketplace) 明确面向 Cursor、Claude Code、Kiro、Grok Build 与 Codex，并提供官方 Grafana Cloud/local MCP 路径。维护身份：**厂商官方（Grafana）**。 | **否。** README 明确每个平台有独立 manifest，根目录列出五类 marketplace；共享 `mcp.json` 或 skills 不会把整仓自动变成 v1 包。 | **Explore**：Pulse 尚未展开多客户端 marketplace，也尚未为 OAuth/stdio 两类 Grafana MCP 做逐插件安装与授权编排。 | **保留，标注 Official by Grafana / Multi-client。** 截至核验日约 16 stars、3 forks、49 commits，不能称社区热门，但作为 observability 厂商一手集成很有代表性。 |
| Gopher AI | [`gopherguides/gopher-ai`](https://github.com/gopherguides/gopher-ai) 自述为 Gopher Guides 维护的 Go 开发跨平台工具包，包含 7 modules，并为 Claude、Codex、Gemini 分别构建安装物。维护身份：**项目方一手维护**，不是 Agent Plugins 规范官方。 | **否。** 仓库根是跨平台源码，Codex 用 `.agents/plugins/marketplace.json`/`.codex-plugin`，Gemini 用 extension，Claude 用 marketplace。 | **Explore**：Pulse 尚未执行其 build/install scripts，也不能把整仓多平台分发物当作单个严格 v1 包。 | **可保留为 Go 垂直样本，降低展示优先级。** 截至核验日约 19 stars、1 fork，但有约 576 commits 与明确模块/安装文档；维护活跃不等于社区主流。 |

### catalog 展示规则

- `Official` 必须带限定对象：`Official by OpenAI`、`Official by Anthropic`、`Official by Grafana` 或 `Agent Plugins reference`；不能只写无归属的“官方”。
- `Community` 可以保留，主流依据应来自上游公开规模、提交活跃度和真实可安装目录，不使用二手榜单。
- `v1` 只表示通过 Agent Plugins v1 schema 与固定布局校验；不能由组织名、README 中的 “plugin” 或某个同名 `plugin.json` 推断。
- `Install` 表示 Pulse 已实现并验证该格式；`Explore` 表示可查看一手来源、等待适配，不代表上游项目质量较低。
- 当前最合理的保留组合是：1 个 v1 reference、3 个厂商官方客户端/skills 来源（OpenAI、Anthropic、Grafana）、1 个社区主流多端市场（wshobson），另以 PleaseAI 与 Gopher AI 作为低优先级格式/垂直样本。

## 经核验的市场与代表性供给

| 来源 | 代表性插件/内容 | 实际格式与分发 | v1 判定 |
|---|---|---|---|
| [`agentplugins/agent-plugins-example`](https://github.com/agentplugins/agent-plugins-example) | `migrate-agent-plugin` skill | 根 `plugin.json` + `skills/`；作为可复制参考包，通过 Git/目录自行交给客户端 | **严格 v1**；官方参考实现，不是市场 |
| [`anthropics/claude-plugins-official`](https://github.com/anthropics/claude-plugins-official) | Anthropic 官方目录，索引 GitHub、npm 等来源的 Claude Code 插件 | `.claude-plugin/marketplace.json`；`/plugin install <name>@claude-plugins-official` | **Claude 专属市场**，条目不能默认视为 v1 |
| [`anthropics/skills`](https://github.com/anthropics/skills/blob/main/.claude-plugin/marketplace.json) | `document-skills`（xlsx/docx/pptx/pdf）、`example-skills`、`claude-api` | Claude marketplace 条目使用 `strict: false` 并显式指向 skills 路径 | **不是严格 v1 包**；skills 可作为迁移/复用候选 |
| [`anthropics/claude-code`](https://github.com/anthropics/claude-code/blob/main/.claude-plugin/marketplace.json) | `agent-sdk-dev`、`code-review`、`commit-commands`、`feature-dev`、`frontend-design` 等 | `.claude-plugin/marketplace.json` + 各插件 `.claude-plugin/plugin.json` | **Claude 专属格式** |
| [`openai/role-specific-plugins`](https://github.com/openai/role-specific-plugins) | Sales、Data Analytics、Product Design | `.agents/plugins/marketplace.json` + `.codex-plugin/plugin.json` | **Codex 专属格式**，不是根 manifest v1 |
| [`pleaseai/claude-code-plugins`](https://github.com/pleaseai/claude-code-plugins) | Cloudflare、Vercel、Playwright、Vue/Nuxt/Vite、AI SDK、Neo4j、Grafana 等 | Claude manifest 为源，生成 `.codex-plugin/plugin.json` 和 `.agents/plugins/marketplace.json`；还生成 Antigravity 根 manifest | **多客户端构建产物，不等于 v1**；是 Pulse 多格式导入的好样本 |
| [`grafana/ai-marketplace`](https://github.com/grafana/ai-marketplace) | `grafana-cloud-mcp`、`grafana-mcp`、`grafana-assistant` | 同仓维护 Cursor、Claude、Grok、Kiro、Codex 五类市场/manifest，共享 skills 与 MCP 配置 | **多客户端适配**；仓库明确说明各平台 manifest 不相同，不能整体标为 v1 |
| [`wshobson/agents`](https://github.com/wshobson/agents/blob/main/docs/plugins.md) | 94 个领域插件、175 个 skills；如 `python-development` | Claude marketplace，`/plugin marketplace add wshobson/agents` 后按插件安装 | **Claude 市场为主**；内容规模大，适合做社区供给索引，但需逐包迁移/校验 |
| [`gopherguides/gopher-ai`](https://github.com/gopherguides/gopher-ai) | `go-workflow`、`go-dev`、`gopher-guides`、`llm-tools`、`go-web`、`tailwind` | Claude marketplace；Codex 使用 `.agents/plugins/marketplace.json`、`.codex-plugin/plugin.json` 或安装脚本；Gemini 另生成 extension | **多客户端生成格式，不是严格 v1** |
| [`xiaolai/claude-plugin-marketplace`](https://github.com/xiaolai/claude-plugin-marketplace) | `cc-suite`、`tdd-guardian`、`echo-sleuth`、`loc-guardian`、`grill`、`docs-guardian` | 同仓提供 `.claude-plugin/marketplace.json` 与 `.agents/plugins/marketplace.json` | **Claude/Codex 双格式**；适合验证双市场摄取 |

以上清单是“有公开仓库和可核验 manifest/安装说明的代表样本”，不是对 GitHub 的穷尽统计。尤其不能用仓库 README 中的“cross-platform”描述替代逐包 schema 校验。

## 各客户端的市场与安装机制

### Agent Plugins v1

v1 只定义包；没有 registry API、marketplace manifest、搜索、评分、签名、结算或升级协议。官方站列出的兼容客户端包括 VS Code、Cursor、GitHub Copilot、ChatGPT & Codex、Kiro、Hermes Agent 和 OpenClaw，但每个客户端可以渐进支持 skills/MCP，分发仍由客户端决定。[兼容客户端清单](https://agent-plugins.org/compatible-clients)

### Claude Code

- 市场入口：仓库根下 `.claude-plugin/marketplace.json`。
- 市场源：GitHub、任意 Git URL、本地路径、远程 `marketplace.json` URL。
- 单插件源：相对目录、GitHub、Git URL/子目录、npm。
- 安装：`/plugin marketplace add owner/repo`，然后 `/plugin install plugin@marketplace`；安装内容复制到用户缓存。
- 可贡献 skills、commands、agents、hooks、MCP、LSP，能力面大于 Agent Plugins v1。

依据：[Claude Code 市场文档](https://code.claude.com/docs/en/plugin-marketplaces)、[发现与安装文档](https://code.claude.com/docs/en/discover-plugins)、[插件格式文档](https://code.claude.com/docs/en/plugins)。

### Codex / ChatGPT

- 当前本地/团队市场入口是 `.agents/plugins/marketplace.json`，插件 manifest 是 `.codex-plugin/plugin.json`。
- OpenAI 自带 `plugin-creator` 也创建 `.codex-plugin/plugin.json`，说明当前产品打包路径与 agent-plugins.org 根 manifest 仍需明确区分。
- marketplace 可指向本地或 Git 来源；Codex CLI 可添加 marketplace，交互式 `/plugins` 用于浏览和安装。
- ChatGPT 与 Codex 还共享 OpenAI 的 universal plugin directory；公开提交、审核和发布属于 OpenAI 产品分发层，不属于 Agent Plugins v1。

依据：[OpenAI Build plugins](https://learn.chatgpt.com/docs/build-plugins)、[Codex marketplace 样例规范（源码）](https://github.com/openai/codex/blob/main/codex-rs/skills/src/assets/samples/plugin-creator/references/plugin-json-spec.md)、[OpenAI role-specific plugins](https://github.com/openai/role-specific-plugins)。

### VS Code / GitHub Copilot

- VS Code 会自动区分四种格式：严格 Agent Plugins v1 根 manifest、Copilot 根 `plugin.json`、Claude `.claude-plugin/plugin.json`、legacy `.plugin/plugin.json`。
- 默认发现 `github/copilot-plugins` 与 `github/awesome-copilot`，也能添加 Claude 风格 marketplace，或直接从 Git URL 安装。
- 因此它是目前最明确的“多格式兼容客户端”参考，但其 agents/hooks/commands 等能力仍是 Copilot/Claude 兼容层，并非 v1 核心。

依据：[VS Code Agent plugins](https://code.visualstudio.com/docs/agent-customization/agent-plugins)、[GitHub Copilot plugin directories](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/plugin-directories)。

### Cursor

- 同时接受严格 v1 根 `plugin.json` 和 Cursor 专属 `.cursor-plugin/plugin.json`。
- v1 用于 skills/MCP；rules、agents、commands、hooks、variables 走 Cursor 格式。
- 支持公开 Marketplace 发布与 GitHub 导入的团队 marketplace，并提供 Default Off / Default On / Required 三类企业安装策略。

依据：[Cursor Plugins 文档](https://cursor.com/docs/plugins)。

## 对 Pulse 市场集成的直接含义

### 建议支持的首批来源

1. **本地目录 / Git 仓库**：优先识别严格 v1 根 `plugin.json`。
2. **Claude marketplace**：读取 `.claude-plugin/marketplace.json`，支持相对目录与 Git 来源；npm 可以后置。
3. **Codex marketplace**：读取 `.agents/plugins/marketplace.json`，支持 local/git 来源。
4. **直接 skills 仓库**：作为“skill collection”导入，不冒充完整 Agent Plugin。

### 内部统一模型必须保留格式身份

建议每条目录记录至少保存：

- `sourceType`：`agent-plugins-v1 | claude | codex | cursor | skill-collection`；
- 原始 marketplace 与 manifest；
- 可移植组件：skills、标准 MCP；
- 客户端组件：hooks、agents、commands、LSP、UI；
- 安装源与不可变版本（commit SHA/tag/version）；
- schema 校验结果、路径越界检查、所需命令/环境变量/网络/OAuth；
- `compatibility` 应是实际验证矩阵，不能仅依据作者声明。

### 可先落地的 MVP

1. `scan`：给定本地路径或 Git URL，检测格式并列出组件。
2. `validate`：严格 v1 schema + Agent Skills 校验 + containment 检查；其他格式使用各客户端 schema。
3. `catalog import`：导入上述三类 marketplace，保留来源和 commit。
4. `install`：复制到 Pulse 管理的不可变 cache，将 skills/MCP 映射到现有 Pulse loaders；客户端专属组件默认不执行。
5. UI：把当前 Skills 页面升级成 Plugins / Skills 两个视图，清楚显示“原生 v1”“已适配”“仅某客户端”。

这个 MVP 不需要先发明一个新的公开 registry。先让 Pulse 能安全摄取现有社区供给，并能把 Pulse 插件导出为严格 v1 + 可选 Claude/Codex 适配层，就已经形成比单一客户端市场更强的差异化。
