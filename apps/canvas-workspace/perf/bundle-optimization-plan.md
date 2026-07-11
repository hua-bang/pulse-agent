# Canvas Workspace 体积专项执行交接

> 状态：已完成并通过最终验收（2026-07-11）。
>
> 审计基线：2026-07-11，commit `0eb7a4a4`。当前数值来自真实
> `electron-vite build`、Rollup module graph、Vite manifest、同版本
> esbuild 转换实验，以及 0.1.14 arm64 发布包的 ASAR 清单。
>
> 本文负责“做什么、为什么、做到什么程度、如何验收”。稳定指标语义仍由
> `program.md` 管理，正式目标和 Gate 数字落地时必须写入
> `baselines.json`，不要把本文变成第二份数值 SSOT。

## 1. 目标与结论

体积专题同时覆盖四个不同问题，不能用单一 `entryRawKB` 代替：

1. **启动体积**：首个 Canvas / LCP 前实际加载并 parse 的 JS + CSS。
2. **功能首用体积**：File editor、Chat、Terminal、Graph、Mermaid 等首次打开成本。
3. **Renderer 总产物**：影响 ASAR、安装包和更新包，但不一定影响启动。
4. **发布包体积**：Main runtime 依赖、重复 Renderer 依赖、Electron locales、原生 unpacked 文件。

不牺牲产品能力的推荐完成态：

| 指标 | 当前验证值 | 推荐完成态 | 激进上限 |
|---|---:|---:|---:|
| Renderer entry JS raw | 1,380 KB | 600–680 KB | 480–560 KB |
| Renderer entry JS gzip | 285 KB | 160–185 KB | 140–160 KB |
| 启动 CSS raw | 284 KB | 120–140 KB | 100–115 KB |
| Renderer total JS raw | 10.60 MB | 5.1–5.3 MB | 3.0–3.5 MB |
| 欢迎画布立即触发的资源闭包 | 约 3.22 MB | 1.4–1.6 MB | 0.75–0.95 MB |
| Main bundle raw | 953 KB | 约 550 KB | 350–450 KB |
| arm64 DMG | 160.8 MB | 100–115 MB | 90–105 MB |
| 解压 `.app` | 471.7 MiB | 255–275 MiB | 205–230 MiB |

“激进上限”依赖 File 轻量预览、Main 深度按需加载或 limited Mermaid，
不是默认承诺。第一期应以“推荐完成态”为验收边界。

最终实测结果：

| 指标 | 审计基线 | 最终实测 | 相对基线 |
|---|---:|---:|---:|
| Renderer entry JS raw | 1,380 KB | 614 KB | -55.5% |
| Renderer entry JS gzip | 285 KB | 179 KB | -37.2% |
| 启动 CSS raw | 284 KB | 105 KB | -63.0% |
| Renderer total JS raw | 10.60 MB | 5.35 MB | -49.5% |
| Canvas / LCP 前真实资源闭包 | 约 3.22 MB | 888.1 / 892.9 KB | 约 -72.9% |
| Main bundle raw | 953 KB | 495 KB | -48.1% |
| arm64 DMG | 160.8 MB | 96.4 MB | -40.0% |
| 解压 `.app` | 471.7 MiB | 234.6 MiB | -50.3% |

Renderer total JS 已通过 Terser 与 chat/editor 共享完整 36 种 common grammar 回到
5.35 MB 推荐目标内；36 种 common 语言及自动检测能力均保留。进一步空间主要是
limited Mermaid 等会改变能力边界的可选项，不纳入默认承诺。最终 Gate 为
23/23，packaged app 已验证首屏、File 预览与编辑器动态加载。

## 2. 已验证事实

### 2.1 当前产物没有 minify

`electron-vite@2.3.0` 三端默认 `build.minify: false`，当前
`electron.vite.config.ts` 没有覆盖。保持现有 chunk 边界，对当前产物使用
项目同版本 esbuild、Renderer target 做转换实验：

| 指标 | 当前 | minify 实验 | 预计降幅 |
|---|---:|---:|---:|
| Entry JS raw | 1,380 KB | 780–805 KB | 42–44% |
| Entry JS gzip | 285 KB | 约 222 KB | 约 22% |
| Total JS raw | 10,603 KB | 5,533–5,587 KB | 47–48% |
| Total JS gzip | 2,198 KB | 约 1,617 KB | 约 26% |
| Initial CSS raw | 284 KB | 197–199 KB | 约 30% |
| Total CSS raw | 501 KB | 354–356 KB | 约 29% |
| Main raw | 931 KB | 约 547 KB | 约 41% |
| Preload raw | 19 KB | 12–13 KB | 约 35% |

这不是正式 build 结果，但已足以把 Renderer minify 定为 Phase 0。Main
压缩需要单独评估错误栈、函数名和插件诊断，不与 Renderer 一次推进。

### 2.2 单 entry 不是实际启动闭包

Vite manifest 的当前静态入口闭包为：

- Entry JS + initial CSS：约 1.66 MB raw。
- 欢迎画布含两个 File 节点，挂载后立即加载 File/Tiptap 闭包：约 1.55 MB raw。
- 因此欢迎画布实际会立即触发约 3.22 MB raw，而不是看板显示的 1.38 MB。

仅 minify 后，上述两段预计分别为约 1.00 MB 和 0.79 MB，合计仍约
1.79 MB。后续必须增加 Canvas/LCP 前资源闭包指标，不能用移动代码到一个
“立即请求的 lazy chunk”制造虚假收益。

### 2.3 Entry 主要是应用代码

当前 entry 中 app-own code 约 1,139 KB；React、ReactDOM、wouter 等
第三方依赖合计约 160 KB。下一刀应拆应用功能边界，不应为了数字再造一个
eager vendor chunk。

经 Rollup module graph 模拟切断静态 import 后，高确定性边界为：

| 边界 | 可移出 entry JS（压缩前 rendered） | 可移出 initial CSS |
|---|---:|---:|
| Global Settings + Workspace Settings | 约 108 KB | 约 42 KB |
| Nodes / Node Detail 实验路由 | 约 52 KB | 约 20 KB |
| DevTools 页面与 Chat 卡片 | 约 28 KB | 约 13 KB |
| Reference Drawer | 约 48 KB | 约 20 KB |
| Command Palette / Edge Panel / Search | 约 34 KB | 约 13 KB |
| 非默认节点类型 | 50–62 KB | 17–33 KB |
| 非当前语言词典 | 约 60 KB | — |

### 2.4 发布包重复携带 Renderer 依赖

0.1.14 arm64 发布物：

| 项目 | 当前值 |
|---|---:|
| DMG | 160.8 MB（153.4 MiB） |
| 解压 `.app` | 471.7 MiB |
| Electron Frameworks | 约 223 MiB |
| `app.asar` | 约 224 MiB |
| 生产 `node_modules` 文件 | 约 229 MiB |
| Electron locales | 55 个，约 37.4 MiB |

Renderer 依赖已被 Vite 打入 `dist/renderer`，但 Mermaid、Tiptap、xterm、
React、Force Graph、Module Federation 等仍在 production dependencies，
Electron Builder 因此又复制完整 npm 包。可迁入 devDependencies 的独占
闭包约 141 MiB，压缩代理值约 38 MiB，其中 Mermaid 族约 108 MiB。

另外：

- `pulse-coder-engine` 声明的 `@requesty/ai-sdk` 当前源码零引用，却通过
  peer Vite 带入 esbuild、Rollup、Sass 等约 32.7 MiB。
- 产品只支持英文/中文，可使用 Electron Builder `electronLanguages`
  按平台保留 `en`、简中、繁中，预计移除 35–37 MiB installed。
- `resources/pulse.png`、`resources/icon@2x.png` 无运行时引用，约 1.8 MiB；
  后者仍是图标生成输入，只应从发布包排除，不应直接删除源码资产。

## 3. 执行顺序

每个 Phase 都应独立提交、独立收紧基线。不要把所有改动塞进一个 PR，
否则无法归因收益，也难以回滚。

### Phase 0A：先修测量口径

> 实施状态：2026-07-11 已完成 manifest 入口/静态闭包、精确总量、Main/Preload、
> feature first-load、Canvas/LCP 前本地资源、归因 SHA-256 校验和 Rollup module
> ID Gate。模块图 Gate 首次发现并修复了 xterm CSS 滞留首屏的问题；新增指标暂为 record。
> 两轮真实 warm trace 观测为 Canvas 前约 3.32–3.34 MB / 13–14 请求、LCP 前约
> 4.05–4.17 MB / 17–25 请求；CDP Network 提供完成时间与字节数，避免 Electron
> `file://` Resource Timing 只报告 navigation 的失真。

**问题**：当前 `perf:bundle` 按体积排序后选择第一个 `index-*`，真正入口
变小后可能误选异步 chunk；单 entry Gate 还可以被 `manualChunks` 轻易
“优化”，但启动总量不变。

**任务**：

1. 使用 Vite manifest `isEntry` 找入口，复用 `bundle-treemap.mjs` 已有逻辑。
2. 递归 manifest `imports`，新增启动静态闭包 JS/CSS raw + gzip。
3. 在 runtime trace 中记录 first Canvas / LCP 前实际加载的本地资源大小。
4. 新增 feature first-load：File、Chat、Terminal、Graph、Mermaid、MF。
5. 修复 total JS“逐文件 KB 四舍五入后再求和”的累计误差。
6. `entry-dep-stats.json` 必须校验 build hash/入口文件名，禁止读取旧归因。
7. built-output 字符串 probe 改为 Rollup module ID / manifest graph Gate。

**建议指标**：

- `bundle.startup_js_raw_kb`
- `bundle.startup_js_gzip_kb`
- `bundle.startup_css_raw_kb`
- `bundle.startup_css_gzip_kb`
- `bundle.startup_request_count`
- `startup.loaded_to_canvas_kb`
- `startup.loaded_to_lcp_kb`
- `bundle.feature_first_load.<feature>_raw_kb`
- `bundle.total_css_raw_kb`
- `bundle.main_raw_kb`
- `bundle.preload_raw_kb`

**验收**：现有基线数值不应因口径迁移被意外改变；新增指标先 record，
确认两轮产物稳定后再 gate。

### Phase 0B：Renderer 生产压缩

> 实施状态：2026-07-11 已启用 Renderer JS/CSS esbuild minify。首轮实测
> Entry 780 KB raw / 224 KB gzip、Total JS 5,546 KB、启动 CSS 189 KB、
> Total CSS 352 KB；Main/Preload 保持 931/19 KB，符合分阶段边界。
> 同机 warm trace 中，Canvas 前资源 3.34→1.89 MB（-43%）、LCP 前资源
> 4.17→2.31 MB（-45%），LCP 655.6→424.2 ms（单轮约 -35%，仅作方向证据，
> 不以单样本承诺固定时延收益）。

**任务**：仅为 Renderer 明确设置 esbuild minify；CSS minify 也必须显式
确认生效。Main/Preload 暂不一起改。

**预计结果**：

- Entry 1,380 → 780–805 KB。
- Total JS 10.60 → 5.53–5.59 MB。
- Initial CSS 284 → 197–199 KB。

**风险检查**：

- 是否依赖 `Function.name` / `class.name`；若有真实失败，再局部评估
  `keepNames`，不要默认全局打开。
- 插件 registry、MF remote、Mermaid、Tiptap、xterm 和 DOM picker。
- 生产错误日志是否仍足够定位。

**验收**：完整 `perf:report`、测试、真实应用 smoke；同 PR 更新
`baselines.json`，ratchet 容差从当前 5%/10% 收紧到 2–3%。

### Phase 1：发布包去重

> 实施状态：2026-07-11 已完成 Renderer-only 依赖迁移、Requesty 删除、
> electron-builder 26.15.6 pnpm workspace 收集修复、3 locales 和资源排除。
> arm64 实测 DMG 160.8→96.6 MB、`.app` 471.7→235.1 MiB、ASAR
> 约 224→44.0 MiB、native unpacked 约 24→2.3 MiB；packaged executable
> 已用独立 HOME + CDP 启动，欢迎 Canvas/3 节点正常且无缺失模块日志。

**任务**：

1. 将纯 Renderer 依赖迁入 `devDependencies`：MF runtime、Tiptap 全族、
   xterm 前端包、highlight/lowlight、markdown、Mermaid、React/ReactDOM、
   Force Graph、wouter 等。Main runtime 使用的 ai、fflate、happy-dom、
   node-pty、engine/teams、zod、Lark SDK 保持 production。
2. 删除 engine 中无源码引用的 `@requesty/ai-sdk`；这是跨 workspace 改动，
   必须按 engine + canvas-workspace validation 执行。
3. 配置各平台正确的 `electronLanguages`，不要把 macOS locale 名直接复制
   到 Windows/Linux。
4. 从发布包排除 `*.map`、类型文件、docs/examples/tests 和无运行时用途的
   PNG；不要盲目排除整个 `src/`，部分第三方包可能从源码入口运行。
5. 增加 packaged dependency allowlist/audit，阻止 Renderer-only 依赖回流。

**预计结果**：arm64 DMG 100–115 MB，`.app` 255–275 MiB，native unpacked
从约 24 MiB 降至约 3–5 MiB。

**必须 smoke**：打包后启动、PTY、AI provider、HTML patch、Feishu、
Mermaid、Tiptap、Graph、MF remote。源码 build 通过不能证明 packaged app
依赖完整。

**建议指标**：

- `package.dmg_mb`
- `package.app_unpacked_mb`
- `package.asar_mb`
- `package.prod_node_modules_mb`
- `package.renderer_dep_duplicate_mb`
- `package.electron_locale_count`
- `package.native_unpacked_mb`

### Phase 2：高确定性功能 lazy

> 实施状态：2026-07-11 已完成 Settings/Workspace Settings 条件挂载、Nodes
> 路由、DevTools 页面与 Chat card、Reference Drawer keep-alive、Command Palette、
> Search、Edge Style、Artifact/Link tab 的真实 lazy 边界，并让相关 CSS 跟随功能
> chunk。静态图 Gate 现直接约束这些应用模块不回流入口。实测 Entry 780→617 KB、
> gzip 224→184 KB、启动 CSS 189→104 KB，达到本阶段推荐完成态；100 节点完整
> perf report 为 70/70 核心指标、13/13 诊断覆盖、19/19 Gate 且无告警。

按下列顺序拆，避免共享模块导致“拆了但没变小”：

1. Global Settings 与 Workspace Settings 一起拆。
2. Nodes / Node Detail 页面及 `WorkspaceNodes/index.css`。
3. DevTools 保留同步注册 shell，页面和 Chat card implementation lazy。
4. Reference Drawer 首次打开才挂载；打开一次后常驻以保留关闭动画与状态。
5. Command Palette、Edge Style Panel、Search Bar。
6. i18n 按当前语言加载；类型定义必须与词典值分离，避免 type import 把
   英文词典重新带进入口。
7. Artifact/Link/Terminal dock 内容按 tab 首用加载，`artifacts.css` 跟随边界。

**关键约束**：`React.lazy` 不等于按需加载。若组件仍以
`<Settings open={false}>` 等形式首屏挂载，chunk 仍会立即请求。必须在首次
打开前不渲染，首次打开后再决定是否 keep-alive。

**预计完成态**：Entry 600–680 KB，entry gzip 160–185 KB，initial CSS
120–140 KB。Total JS 不会因代码分割显著下降，这是正常结果。

### Phase 3：真实首屏——File preview/editor 分层

> 实施状态：2026-07-11 已完成 File Markdown 安全预览/Tiptap 首次编辑分层，
> 并处理同源的 Text 编辑器与关闭状态 ChatPanel；Canvas Search 仅在搜索实际
> 打开且有查询时加载 ProseMirror 高亮扩展。编辑器首次加载后保持挂载，性能
> 场景也改为显式跨越 preview→editor 边界后再测打字。warm reload 实测首个
> Canvas 资源 1,650.7→961.2 KB、LCP 资源 2,071.6→966.1 KB，LCP 约
> 471–626→213 ms，Long Task 从 1 个/114–127 ms 降为 0；8×100 节点循环
> 峰值堆从约 169 MB 降至 21.9 MB。完整报告 70/70 核心、13/13 诊断、
> 20/20 Gate 通过。

**问题**：欢迎画布的 File 节点一挂载就创建完整 Tiptap editor；仅移动它
到 dynamic chunk 并未消除首屏成本。

**推荐方案**：

1. 非编辑态渲染轻量、安全的 Markdown preview。
2. 用户聚焦/进入编辑态后加载 Tiptap，加载完成前显示稳定尺寸 fallback。
3. 编辑器加载后保留实例，避免频繁进出编辑态反复初始化。
4. Chat 与 File 建共享 grammar registry；最终复用完整 36 种 common
   grammar，在不缩减语言支持的前提下消除两套重复注册。

**备选方案**：只用 `requestIdleCallback` 延后 Tiptap。实现更小，但只是把
长任务后移，内容也可能闪烁，不是推荐终态。

**预计结果**：欢迎画布启动资源闭包从 Phase 2 的约 1.4–1.6 MB 降至
0.75–0.95 MB；目标是 warm reload 最大 Long Task <70 ms，最终 <50 ms。

### Phase 4：Main/插件按需加载

> 实施状态：2026-07-11 已完成 Main esbuild minify；Feishu、Agent Teams、
> happy-dom HTML patch 与关闭的实验插件均拆为条件动态 chunk。Agent Teams 的
> IPC/heartbeat 只在开关启用时启动，control server 的 team API 首次调用再加载
> service。内置 mock renderer 改为本地静态插件，只有真实 remote 配置才加载
> MF runtime。Main 入口实测 931→495 KB，独立产出 Feishu 26.9 KB、Agent Teams
> service 89.1 KB、HTML patch 2.0 KB 等首用 chunk；同机 whenReady 321→198 ms、
> openWindow 367→244 ms。欢迎画布资源闭包最终 888.1 KB，LCP 闭包 892.9 KB，
> 达到激进完成态。

单独立项，不与 Renderer lazy 混做：

- Channel 插件保留轻量 `enabledWhen` shell，仅在 flag + config 命中后
  dynamic import Feishu SDK 和实现。
- Agent Teams 按实验开关加载 service/heartbeat。
- `happy-dom` 仅在 HTML patch 工具首用时加载。
- MF built-in mock 改为静态本地插件，只有配置真实 remote 时才加载 MF runtime。
- 评估 Main `minify:'esbuild'`；先保留可诊断错误栈，再决定是否 `keepNames`。

推荐目标是 Main raw 约 550 KB；350–450 KB 需要更深的 domain split，
不作为第一期硬 Gate。

### Phase 5（可选）：limited Mermaid

当前 Mermaid 已正确 lazy；minify 后全可达产物仍约 3.07 MB。若产品明确
只支持 flowchart、sequence、state、ER、class、gantt，可维护 limited build，
把 Mermaid 降到约 0.8–1.1 MB，并让 Renderer total JS 进入约 3.0–3.5 MB。

这会带来少见图类型降级、历史内容兼容和 Mermaid 升级维护成本。没有明确
产品决策时不得实施，也不得仅为让 `total_js_kb` 好看而静默删除能力。

## 4. 提交与验收协议

每个任务统一执行：

1. 运行当前基线并保存 `report.json`、manifest 和相关 package 报告。
2. 只实现一个可归因边界。
3. 跑局部测试，再跑 workspace validation。
4. 对照 raw、gzip、启动闭包、Long Task 和功能首用成本。
5. 收益成立时，同 PR 下调 `baselines.json`；没有改善则回滚或解释原因。
6. 更新本文任务状态和实测值，不复制新的正式 Gate 数字到本文。

常用命令：

```bash
pnpm --filter canvas-workspace typecheck
pnpm --filter canvas-workspace test
pnpm --filter canvas-workspace perf:report
PULSE_CANVAS_ANALYZE=1 PULSE_CANVAS_PERF_ANALYZE=1 pnpm --filter canvas-workspace build
pnpm --filter canvas-workspace package:mac:arm64
```

发布包改动还需启动 `release/mac-arm64/Pulse Canvas.app` 并使用 temp HOME 做
真实功能 smoke。不要只比较 DMG 大小。

## 5. 非目标与防误区

- 不为降低单 entry 数字把 React 拆成 eager vendor chunk。
- 不把 gzip 当 Electron `file://` 启动成本；启动北极星是 raw/eval 闭包。
- 不用更多小 chunk 替代真正的按需挂载。
- 不优先替换 xterm、Tiptap 或 Force Graph；它们已在合理 lazy 边界内。
- 不在没有产品决策时裁 Mermaid 图类型。
- 不通过排除整个第三方 `src/` 目录冒险破坏运行时入口。
- 不把未压缩基线继续当作长期产品目标。

## 6. 证据索引

- 当前操作与报告入口：`README.md`
- 性能指标体系：`program.md`
- 正式阈值：`baselines.json`
- 当前分析产物：`out/bundle-report.json`、`out/bundle-treemap.html`、
  `out/report.json`
- 构建配置：`../electron.vite.config.ts`
- 发布配置和依赖分类：`../package.json`
- 启动静态 import：`../src/renderer/src/App.tsx`
- File/Tiptap 首用链：`../src/renderer/src/components/FileNodeBody/index.tsx`、
  `../src/renderer/src/hooks/useFileNodeEditor.ts`
- 体积采集实现：`../scripts/perf/bundle-report.mjs`
