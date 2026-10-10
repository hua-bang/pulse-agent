# Pulse Codemode Spec

状态：Engine 插件与嵌套执行契约已实现；Canvas 已接入 `agent-codemode` 开关与只读工具名单（见 [Canvas security posture](../../../apps/canvas-workspace/harness/knowledge/security-posture.md)）；已完成调用的嵌套明细与 tracing 父子关系已接入；运行中逐条进度、Mac 安装产物验收与真实模型收益验收仍待完成。已实现行为由 [Engine plugin knowledge](../../../packages/engine/harness/knowledge/plugin-system.md#opt-in-codemode) 维护；下文保留整体目标与宿主验收要求。

已确认方向：Pulse 自己实现 Codemode 的运行器、工具桥接与生命周期，不依赖 Pi Codemode 包。Pi 仅作为设计参考。

## 当前状态与设计问题

Pulse 已有统一工具注册、工具搜索、工具 hooks 和外部模型执行会话；当前事实由 [Engine contracts](../../../packages/engine/harness/knowledge/contracts.md)、[tools reference](../../../packages/engine/harness/knowledge/tools-reference.md) 和 [Canvas chat sessions](../../../apps/canvas-workspace/harness/knowledge/chat-sessions.md) 维护。

2026-10-02 核对的源码证据：

- [Engine.ts](../../../packages/engine/src/Engine.ts)：`createToolSession` 区分注册表与可见工具；`executeTool` 每次关闭模型步骤、记录结果并刷新可见表。
- [pi-tool-adapter.ts](../../../apps/canvas-workspace/src/main/agent/backends/pi-tool-adapter.ts)：现有 Pi 桥接通过 Engine 策略执行，明确采用串行模式。
- [ptc-plugin.ts](../../../packages/engine/src/built-in/ptc-plugin/ptc-plugin.ts)：提供调用者过滤，未提供脚本沙箱。
- [engine-plugins.ts](../../../apps/canvas-workspace/src/main/agent/engine-plugins.ts)：Canvas 显式组合 MCP、工具搜索与结果 offload。
- [Canvas package.json](../../../apps/canvas-workspace/package.json)：Pi 依赖锁在 0.83.0，Electron 为 ^30.0.0。

需要确认的设计是：在保留现有模型运行时、工具策略和宿主会话所有权的前提下，增加跨模型的程序化工具调用能力。脚本内部调用是否进入模型历史、如何通过策略、如何展示和停止，必须具有统一契约。

本 spec 由 root 持有，因为契约横跨 Engine 的工具执行与 Canvas 的运行时、可观测性和打包。Engine 与 Canvas 分别拥有各自实现和验证；不另建工具注册表或会话存储。

## 目标与第一版范围

模型可以提交 JavaScript，按顺序调用多个已允许的工具，在脚本内执行循环、条件判断、过滤和统计，仅将显式输出与返回值交回模型。

第一版应同时适用于 Canvas 的 Engine 后端和实验性 Pi 后端，使用同一工具策略。原有直接工具调用继续可用；单次小查询无需使用 Codemode。

典型任务是批量查询节点或 MCP 数据，输出数量、分组统计或有限的匹配记录。已启用且属于当前 scope 的 MCP 工具默认可编排，继续执行既有 scope、权限和审批检查。普通工具由宿主明确选定，优先接入读取和查询类。

第一版不提供：嵌套工具并发、跨脚本状态、远程 JS 执行器、崩溃恢复、自动重放、Durable 集成、Anthropic 托管 PTC、修改默认 agent runtime、直接调用模型、后台脱离当前 turn 的任务。普通工具中的文件写入、shell、发送消息和部署等操作不自动授权；MCP 中的副作用操作继续经过原有审批。

## 自有实现与运行时兼容门槛

Pulse 拥有并维护 Codemode 的脚本接口、worker 运行器、异步工具桥接、串行调度、输出控制、取消和资源清理。不引入 `@earendil-works/pi-codemode`，不因此升级现有 `pi-ai` / `pi-agent-core`，也不迁移整个 Pulse runtime。

借鉴 Pi 的能力注入与结果隔离：脚本只调用获授权的工具，中间结果留在脚本，显式输出和返回值进入模型上下文。官方 [README](https://github.com/earendil-works/pi/blob/main/packages/codemode/README.md) 是设计参考，不是 Pulse 的运行时依赖或接口规范。

底层采用 `quickjs-emscripten-core@0.32.0` 与 `@jitl/quickjs-wasmfile-release-sync@0.32.0`；只分发实际使用的发布版同步 WASM，不带入调试和 asyncify 变体。Pulse 自己编写 QuickJS/WASM 运行与桥接层，不自行实现 JavaScript 解释器。Node 引擎测试不代替当前 Electron 与安装产物的资源加载验证。

脚本在独立 worker 的隔离 VM 中执行，仅通过传递 JSON 的消息协议请求宿主工具。worker 用于避免阻塞主线程和控制进程内生命周期；能力隔离由 VM 与受限桥接承担，不能把 worker 本身视为安全沙箱。不得把 Node vm 或主进程 eval 当作能力隔离替代。

移除 Pi Codemode 依赖后，其 Node >=22.19.0 要求不再是 Pulse 的准入条件。首发仍必须在当前 Electron 及安装产物中证明所选底层运行时、worker 启动、WASM 加载、工具桥接、超时和取消可用。不能以开发机 Node 版本代替目标运行时验证，不得静默升级 Electron。兼容性不成立时功能保持不可用，依赖或宿主升级应另行决策。

## 执行与所有权

```text
模型运行时（Engine / Pi）
  -> codemode 工具
  -> Pulse 自有 worker 运行器与 QuickJS/WASM 沙箱
  -> 当前 run 的嵌套工具执行边界
  -> schema 校验、调用者策略、before/afterToolCall
  -> 原有 Canvas / MCP / Engine 工具

工具结果 -> JS 沙箱 -> 显式输出与返回值 -> 模型
嵌套执行事件 -> 宿主工具记录与可观测性
```

外层 Codemode 是一次普通工具调用。脚本与嵌套调用归属于同一个 run、session、scope 和外层 toolCallId。外层执行结束前不得遗留正在运行的 worker 或排队工具。

嵌套执行复用既有工具执行规则，但不能通过递归启动 `Engine.run` 或重新创建 `EngineToolSession` 实现。一个真实模型请求仍只有一次真实模型生命周期；每次嵌套调用不能触发 `beforeRun`、伪造 `beforeLLMCall` / `afterLLMCall` 或重置工具搜索状态。

必须建立可供原生 loop 和外部 ToolSession 共同使用的嵌套执行边界。它接收当前 run 的策略上下文，承担校验、策略与工具 hooks；不追加模型历史，不产生模型请求。必要的 core 改动仅限共享执行边界，沙箱逻辑仍由插件负责。

## 模型与脚本接口

模型工具名为 `codemode`，输入是 `{ code: string }`，code 为 async 函数体，支持顶层 await 与 return。第一版不依赖任何模型厂商的自由文本或 grammar 工具扩展。

沙箱只提供以下能力：

| 接口 | 契约 |
|---|---|
| `tools[原始工具名](参数)` | 调用当前允许的工具；第一版不提供名称归一化别名，避免碰撞 |
| `ALL_TOOLS` | 当前通过策略且获编排授权的工具名称与简短描述；不暴露秘密或所有已注册工具 |
| `describeTools(名称数组)` | 返回允许工具的参数与输出 JSON Schema；仅供发现，不执行工具 |
| `text(value)` | 显式输出文本或 JSON 可序列化值 |
| `return value` | 返回最后的 JSON 可序列化值 |

不注入 process、require、fetch、文件句柄、凭证、任意宿主 eval、store/load 或宿主全局对象。第一版输出限于文本与 JSON；图像和 MCP App 的富展示仍使用直接工具路径；脚本仅接收其数据结果，审批仍由宿主管理。

Codemode 工具描述只介绍执行规则，不重复整个工具库 schema。模型可先运行脚本筛选 `ALL_TOOLS` 并输出 `describeTools`，再提交执行脚本。工具搜索控制直接调用的模型展示；脚本发现不需要先把延迟工具激活到模型工具列表。

## 工具发现与权限

每次嵌套调用使用 `beforeLLMCall` 策略处理后的工具表，再与编排资格求交，排除 `codemode` 自身。MCP 注册边界标记 `Tool.codemode: true`，不按名字前缀推断；普通工具通过宿主 `allowedTools` 或显式 true 标记接入。`codemode: false` 优先禁止编排。

`prepareToolPresentation` 在所有策略 hooks 之后处理模型展示和延迟声明，只能过滤名称或更新描述，不能恢复被拒绝的工具或替换执行包装。仅因延迟展示而隐藏的 MCP 工具可直接编排；被策略过滤或禁用的工具不能通过猜名字、ALL_TOOLS 或底层注册表调用。脚本不能自行设置 callerSelectors、scope、权限回执或 resultTarget。

工具搜索沿用加载状态，直接调用在下一次真实模型步骤刷新展示。搜索不构成授权；其发现范围也使用当前策略表。编排资格不依赖搜索激活，不新增模型生命周期。普通工具的具体适用性和已知取消/展示限制由 [Engine tools reference](../../../packages/engine/harness/knowledge/tools-reference.md#ordinary-tool-suitability) 维护。

每次执行继承宿主原始 runContext、abortSignal 和工具上下文；嵌套关联信息由宿主添加。参数校验、beforeToolCall 的重写或拒绝、afterToolCall 的结果重写各发生一次，不能直接调用原始 `tool.execute` 绕过这些行为。

既有 `allowed_callers` 约束仍有效；首发宿主没有安装 PTC 插件时，不得仅凭该字段存在便宣称已实施约束。嵌套执行边界须明确验证调用者规则，复用现有匹配语义。

## 串行、错误与取消

同一脚本的嵌套调用按到达顺序排队，最多一个正在执行。即使脚本使用 Promise.all，宿主也只能串行执行。不同 session 的队列互相隔离。

参数错误、不可用工具、工具异常和执行限制形成可捕获的脚本错误。beforeToolCall 返回的合成 output 继续按原有工具结果语义返回；不能把明确拒绝记为底层工具执行成功。错误结果不自动重试工具。

外层脚本失败保留此前显式输出及嵌套状态，不隐瞒已经完成的调用，也不自动重放整段代码。输出必须告知可能存在已完成操作。

停止、超时和宿主退出使排队调用不再启动，取消传递到正在执行的工具，同时终止 worker。未 await 的调用在脚本结束时取消；迟到结果不能再次写入已结束脚本或其他 session。取消不能保证撤销外部已发生的效果。

## 结果、offload 与历史

工具结果必须可 JSON 序列化；字符串保持字符串，不猜测性解析 MCP 文本。不可序列化结果以明确错误报告。类型声明不替代运行时输入校验。

在 `ToolExecutionContext` 增加可选的宿主元数据 `resultTarget: 'model' | 'script'` 与 `parentToolCallId`。省略 resultTarget 时沿用 model 行为。脚本不能构造该上下文。

全部策略相关 afterToolCall 重写必须完成后才交给脚本。仅模型展示用的 offload 对 script 目标不把结果替换成文件 stub；既有 MCP 结果捕获仍执行。已在工具内部截断的结果不因此还原，脚本看到的完整性受原工具契约限制。

嵌套原始结果不追加到 provider 的 messages，宿主也不得把调试记录再次塞进系统提示。模型只接收脚本显式输出、return 值与有限错误摘要；外层聚合结果继续经过既有模型 offload。

第一版固定上限：脚本源码 64 KiB UTF-8、墙钟 60 秒、VM heap 64 MiB、每脚本最多 100 次工具请求、单次参数 JSON 编码默认 64 KiB（宿主可显式配置，最大 1 MiB；Canvas 使用 512 KiB）、宿主排队参数总计 1 MiB、单次嵌套结果 JSON 编码 2 MiB、累计交给 VM 的结果 16 MiB、显式输出与 return 编码总计 30,000 字符。参数限制必须在 worker 发消息前执行，宿主入队时再次验证，不能等慢工具结束后才限制内存。限制覆盖失败、打印循环和排队请求。显式 text 输出超限时返回带标记的首尾预览，并设置 outputTruncated；不因此将已成功的工具调用标成脚本失败，也不重放操作。有效 return 值优先占用输出预算；不足时进一步缩短文本预览。return 编码本身超限及其他执行限制仍报告错误，不能截断 JSON 成非法内容。墙钟包含队列及工具执行时间。

## 宿主展示与启用

Canvas 在现有 Experimental 设置注册 `agent-codemode`，默认关闭，与 `pi-agent-harness` 开关独立。开启后仅在运行时兼容检查通过时注册工具；关闭或缺少资源时保持直接工具可用，并清楚说明不可用原因。

Engine 通过显式插件工厂与宿主授权配置接入；首发不加入所有宿主的默认 built-in 列表。工厂通过现有公共 barrel 导出，兼顾 ESM/CJS 消费者，底层运行时依赖按需加载；功能关闭时不创建 worker 或加载 WASM。

Canvas 用一个外层 Codemode 工具记录容纳脚本与嵌套调用摘要，每个子调用有独立 ID、parentToolCallId、名称、状态与耗时。嵌套事件必须进入现有 tracing，不伪造模型生成事件。

嵌套记录复用现有 session 持久化流程；reload 后保留脚本及完成、失败、停止状态。不得展示假的单个成功而隐藏子调用失败。MCP App 工具首发不进入授权集，避免把嵌套调用误当成可展示的 App 实例。

worker 与 WASM 资源必须在开发、生产打包与安装产物中使用宿主指定的真实资源路径；不得依赖源码 checkout、cwd 或用户全局安装。关闭功能后不需要迁移历史数据，旧记录仍可显示。

## 验收

以下是实现必须满足的行为，不是本次文档已执行的验证。

| 场景 | 必须观察到 |
|---|---|
| 100 条记录筛选与统计 | 与直接调用的确定性预期一致；完整嵌套结果不进入模型历史 |
| Claude / OpenAI；Engine / Pi 后端 | 使用同一宿主授权、取消和结果契约 |
| 延迟搜索后执行 | 新加载的允许工具可用；未批准、被移除和猜名工具不能执行 |
| schema 错误、策略重写与拒绝 | 不合法输入不执行；hooks 恰好一次；拒绝不产生底层副作用 |
| Promise.all、多 session | 同脚本最大并发为 1；跨 session 无工具表、结果或队列串扰 |
| 工具异常与部分成功 | 可捕获错误；保留已完成记录；不自动重试或伪造全部成功 |
| 超时、死循环、停止、未 await | UI 保持响应；队列停止；工具收到取消；worker 被清理 |
| 大结果、offload、超限 | 脚本拿到受策略处理的结果；外层可 offload；超限明确失败 |
| session reload | 嵌套状态保留；原始工具结果没有重新注入模型历史 |
| ESM/CJS 与已安装 Electron | 模块、worker、WASM 正确加载；不以开发态成功代替打包验收 |

复用现有验证入口：[Engine validation](../../../packages/engine/harness/validate/README.md)、[Canvas validation rules](../../../apps/canvas-workspace/harness/validate/validation.yaml)、[Canvas validation protocol](../../../apps/canvas-workspace/harness/skills/validate-canvas-change/SKILL.md) 与 [root acceptance](../../../AGENTS.md)。实现需运行 Engine 和 Canvas 的 test、typecheck、build；性能与打包变更按宿主协议执行 release 验证及真实 app 场景。

收益验证用同一模型、相同数据和固定预期的批量查询任务，记录模型请求数、实际输入 token、端到端耗时、错误与结果准确性。至少包含多个小查询汇总和一个超过 offload 阈值的结果筛选；报告实际测量，不承诺预设降幅。功能启用前必须证明模型上下文不包含未显式输出的嵌套数据。

## 决策与完成边界

自有 Codemode、串行执行与显式宿主授权方向已经确认。Engine 插件已经可显式安装，Canvas 产品开关与只读首发名单已接入。尚未取得安装产物中的 Electron 运行证据，也未测量真实模型收益；Canvas 接入者负责完成这些验收，不兼容时提交独立决策。

实现完成后，已实现的契约迁入各 owner 的 Knowledge，行为由测试与本地 validation 约束；按 harness 规则退役已解决 spec。Codemode 不因保存宿主记录便获得 Durable 恢复语义。
