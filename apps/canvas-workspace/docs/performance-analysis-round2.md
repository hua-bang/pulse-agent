# Canvas Workspace 性能分析报告(第二轮:前端资源 / 首屏渲染 / 运行时)

## 执行摘要

本轮在第一轮(节点渲染无视口裁剪 culling、keep-alive 页面 eager mount 等"渲染扇出"主题)之外,沿**前端资源 / 首屏渲染 / 运行时**三维补充了一批**非重复**的新发现。核心结论有三:(1)**前端资源**——`canvas` 路由从 `App.tsx` 到 `DefaultCanvasNode.tsx` 是一条 100% 静态 import 链且全仓 **0 个 `React.lazy` 边界**,导致 Tiptap 全家桶、lowlight `common`(~35 个 highlight.js 语法)、xterm、markdown-it+hljs 等几乎所有重依赖被折叠进启动 chunk,即使打开的是空画布;(2)**首屏渲染**——主进程 `bootstrap.ts` 把"seeding + 工具环境 + 内建插件 + 外部插件"4 步串行 `await` 全部压在 `openWindow()` 之前,且默认 welcome 工作区在首屏关键路径上挂载一个**指向外部 URL 的 live `<webview>`**(本轮唯一 high);(3)**运行时**——稳态盲区集中在 force-graph(particle 钉死 rAF、每帧 per-node `measureText`、toggle 触发 12s 物理重热、全工作区 onChange 重载)、offscreen webview 仅降帧不停 JS/timer/网络、mermaid 主线程同步渲染等,均为第一轮 culling 议题未覆盖的稳态 CPU。注意:这是 Electron 桌面应用,renderer chunk 从本地磁盘 `file://` 加载,**无网络下载成本**,以下资源类发现的真实代价是**主线程 parse+eval 时间**,所有体积/耗时数字均为**估算**(依赖未安装,本轮无法 profiling)。

---

## 一、前端资源 (bundle / 依赖体积 / 资源加载)

> 公共背景:`apps/canvas-workspace/electron.vite.config.ts` 的 renderer 段无 `build.rollupOptions.output.manualChunks`,全仓 `React.lazy` 边界为 0(唯一的运行时 `import()` 代码分割点是 `chat/utils/mermaid.ts`)。因此下列静态 import 全部折叠进同一个启动 chunk。

### 1.1 [medium] 所有 8 种节点 body 的依赖联合体被静态拉进首屏 chunk
- **文件:行**:`apps/canvas-workspace/src/renderer/src/components/CanvasNodeView/DefaultCanvasNode.tsx:12-19`(JSX 分发 222-261)
- **类别**:frontend-assets / first-paint
- **证据**:第 12-19 行静态 import 全部 8 个 body(`AgentNodeBody`、`DynamicAppNodeBody`、`FileNodeBody`、`FrameNodeBody`、`IframeNodeBody`、`PluginNodeBody`、`TerminalNodeBody`、`TextNodeBody`)。JSX 是 `node.type === ...` 运行时三元链——**类型判别是动态的,但 import 是静态的**。各 body 拖入各自重依赖:FileNodeBody→`useFileNodeEditor`(StarterKit + 14 个 `@tiptap/extension-*` + `tiptap-markdown` + `CodeBlockLowlight` + lowlight `common`);TextNodeBody→`textNodeExtensions.ts`(第二份 StarterKit/ProseMirror 配置);TerminalNodeBody→`@xterm`。DefaultCanvasNode 可从 keepAlive 的 `canvas` 路由静态到达,故即使画布只含一种节点类型(或零节点),依赖联合体也在启动时全部加载。已核对:第 12-19 行确为 8 个 body 的静态 import。
- **影响**:首屏成本 = **每种 body 依赖权重之和**,而非画布上实际存在的 body 的成本。只含 terminal 节点的工作区仍付完整 Tiptap+lowlight 代价;空画布全付。这是收缩 canvas 启动 chunk 的主杠杆。
- **估算**:延迟权重合计(Tiptap 栈 + lowlight common + xterm)数百 KB minified 移出关键路径(**估算**)。
- **修复**:将每个 `*NodeBody` import 改为 `React.lazy(() => import('../FileNodeBody'))`,body switch 外包 `<Suspense fallback={…}>`(可复用 culling 占位框)。三元已经 gate 渲染哪个 body,lazy() 后只有画布上实际实例化的类型才取对应 chunk。配合在 `electron.vite.config.ts` 加 `manualChunks` 给 Tiptap/xterm/lowlight 稳定的共享 async chunk。
- **置信度**:0.82

### 1.2 [medium] xterm `Terminal` 类被 5 个 renderer 文件静态 import 进启动 chunk——与已验证的 mermaid lazy 模式正相反
- **文件:行**:`apps/canvas-workspace/src/renderer/src/components/TerminalNodeBody/index.tsx:3-4`
- **类别**:frontend-assets
- **证据**:`import { Terminal } from '@xterm/xterm';` / `import { FitAddon } from '@xterm/addon-fit';` 顶层静态。同样的静态 import 出现在 `AgentNodeBody/useAgentNodeController.ts:2-3`、`AgentNodeBody/utils/terminal.ts:1-2`、`WorkspaceTerminalDock/index.tsx:3-4`,外加 `main.tsx:5` 的 CSS 副作用 `import "@xterm/xterm/css/xterm.css"`。但 `Terminal` 只在 `initTerminal`(TerminalNodeBody:122)里 `new Terminal(TERMINAL_OPTIONS)`(126/145)按需构造,由 terminal 节点 mount 时的 useEffect 触发。对比同目录 `chat/utils/mermaid.ts:15-29` 自带注释的正确范式(`import('mermaid')` 仅首个 mermaid fence 触发)。无 manualChunks → xterm 核心 + fit addon + xterm.css 全部并入首屏前的启动 chunk。
- **影响**:打开空/纯文件画布的用户即便从不开终端,启动时也照付完整 xterm parse+eval。`Terminal` 是带 renderer/buffer/parser 子系统的大类。这是单点价值最高的缺失 lazy 边界,且与已做对的 mermaid 形成直接不对称。
- **估算**:~250KB min / ~80KB gzip xterm 核心 + ~5KB fit addon 从启动 chunk 移除;~30-60ms script-eval 推迟出首屏(**估算**,Electron 本地加载,真实代价为 parse/eval 而非下载)。
- **修复**:套用 mermaid.ts 模板——引入 `loadXterm(): Promise<{Terminal, FitAddon}>`(`import('@xterm/xterm')`/`import('@xterm/addon-fit')`),模块级 promise memoize;将已是 async 的 `initTerminal` 改为 `await loadXterm()` 后再构造;把 xterm.css 从 `main.tsx` 移入该 lazy 模块(或首次 terminal mount 时注入)。保持 `terminalTheme.ts`/`utils/terminal.ts` 的 `import type` 为纯类型(零成本)。
- **置信度**:0.85

### 1.3 [medium] RightDock / Chat 面板首屏无条件挂载,经 mentions.ts 再导出把 markdown-it + highlight.js/lib/common 静态拉进启动 chunk
- **文件:行**:`apps/canvas-workspace/src/renderer/src/components/chat/utils/markdown.ts:1-3`(再导出于 `mentions.ts:5`,消费于 `ChatMessage.tsx:6,115,121`)
- **类别**:frontend-assets
- **证据**:markdown.ts 第 1-3 行静态 import 全套(`highlight.js/lib/common`、`markdown-it`、`markdown-it-task-lists`),并在模块顶层 eager 实例化(`const markdown = new MarkdownIt({…})` 第 42 行,`markdown.use(taskLists,…)` 第 51 行)。`new MarkdownIt()` 构造与 ~35 个语法注册在模块 init 时跑,早于任何 chat 消息存在。隔壁 mermaid.ts 证明团队懂 lazy 范式,markdown.ts 反其道。
- **影响**:每次冷启都 parse+eval markdown-it 核心 + hljs `lib/common`(~35 语法,每个有副作用注册)。从不打开 chat 的用户也照付。结合 xterm,这是首屏 chunk 中只在交互时才需要的 chat/terminal 库。
- **估算**:~250KB min / ~75KB gzip(markdown-it ~100KB + hljs common ~150KB)移出启动;~20-40ms MarkdownIt 构造 + 35 语法注册移出首屏(**估算,偏高,视为粗估**)。
- **修复**:把 renderMarkdown 改 lazy(镜像 mermaid.ts:`loadMarkdown(): Promise<(s)=>string>` 用 `Promise.all([import('markdown-it'), import('highlight.js/lib/common'), …])`)。因 `renderMdWithMentions` 在 ChatMessage 同步渲染中调用,最干净的切点是路由级动态 import:`React.lazy(() => import('./components/chat/ChatView'))`,让整个 chat 子树(含 markdown 栈)成为面板/路由首次激活时加载的独立 chunk。这可作为全仓**第一个** React.lazy 边界。
- **置信度**:0.85
- **校正(对抗性核验)**:finding 把 RightDock 写成挂载点,但真实静态可达性走的是 `Workbench`(`App.tsx:514` 无条件渲染),而非 RightDock(后者由 Workbench portal 注入 ChatPanels);`ChatPage` 提供第二条无 flag 静态路径。结论不变;字节/耗时估算偏高。

### 1.4 [medium] `createLowlight(common)` 在模块顶层把完整 highlight.js `common`(~35 语法)拉进首屏 canvas chunk,空画布也付
- **文件:行**:`apps/canvas-workspace/src/renderer/src/hooks/useFileNodeEditor.ts`(import 第 17 行,`const lowlight = createLowlight(common)` 第 36 行)
- **类别**:frontend-assets / first-paint
- **证据**:已核对——第 17 行 `import { common, createLowlight } from 'lowlight';`,第 36 行 `const lowlight = createLowlight(common);` 在**模块顶层**(非 hook/extension factory 内)执行。静态可达链:`App.tsx`(`<PulseRouterView name='canvas' keepAlive>`)→ CanvasSurface → CanvasNodeView/index.tsx → DefaultCanvasNode.tsx(第 14 行 `import { FileNodeBody }`)→ FileNodeBody/index.tsx(第 5 行 `import { useFileNodeEditor, getMarkdown }`)→ 本模块。`common` 是 lowlight 打包的 ~35 个 highlight.js 语法。Rollup 把 `createLowlight(common)` 与全部语法折进同步启动 chunk,与画布是否含 file 节点无关。`CodeBlockLowlight.configure({ lowlight })` 仅在 FileNodeBody mount 时调用,但语法表已在启动时构建并驻留。
- **影响**:~35 语法在初始 renderer 脚本求值期间(首屏前)解析、`createLowlight(common)` 注册表建立,每次启动(含空画布)都付——首屏关键路径的主线程 JS parse+execute + 可能永不使用的语法表常驻堆。
- **估算**:35 个 `common` 语法 ~120-180KB min;与 Tiptap core+pm+extensions 合计 ~250-400KB min,是最重的单个 renderer 启动组(**估算**)。
- **修复**:(1)curated 子集——`createLowlight()` 空起,`lowlight.register({ javascript, typescript, python, bash, json, … })` 只注册笔记实际用到的少数语言(~5-8 个,削减 70-80% 语法 payload);(2)更彻底——把整个 Tiptap/file-editor 栈包进 `React.lazy(FileNodeBody)` + `<Suspense>`,只含 terminal/agent/frame 的画布首屏永不 parse lowlight+tiptap。
- **置信度**:0.85

### 1.5 [medium] AI/HTML iframe 节点把完整生成 HTML 内联进 per-node 画布 state,每次 read-merge-write 保存来回序列化
- **文件:行**:`apps/canvas-workspace/src/renderer/src/components/IframeNodeBody/useIframeNodeState.ts:301-308,366-372`
- **类别**:state-bloat / asset-weight
- **证据**:AI/HTML commit 时整篇文档写入 `node.data`:`onUpdate(node.id, { data: { ...data, html: result.html, prompt, mode: 'ai' } })`(stream 完成)与 `data: { ...data, html: draftHtml, mode: 'html' }`(commit)。html-mode 无 file-ref 间接层(不同于 image 节点存 `data.filePath`)。`storage.ts` `writeCanvasFullV2` 把该 data 原样写进 `nodes/<id>.json`;`store.ts` `canvas:save` 每次保存做**两遍** `mergeExternalNodes`(firstPass + merged),各自读每个 node 的磁盘 JSON、parse、再 stringify。`visibleFieldsChanged` 额外在每个 per-node watcher 触发时 `stableStringify` data。
- **影响**:每个 AI 生成"视觉"通常是内联 CSS/JS 的自包含文档(20-200 KB),几个节点即让工作区序列化 state 达数百 KB 到低 MB。每次 autosave 在读/merge 路径解析+序列化 3-4 次;同一 html 串同时驻留 React state(`data.html`)与 iframe srcDoc DOM,per-node 内存翻倍。
- **估算**:每节点 20-200 KB;每次保存 3-4x parse+serialize;~1MB 工作区 state 下每次保存数十 ms 主进程事件循环阻塞(**估算**)。
- **修复**:像 artifact(只存 `artifactId` 懒解析)或 image(`filePath` ref)那样持久化——把 html 内容移入 per-node 旁路文件 `nodes/<id>.html`,data 只存 ref + hash;至少在 merge 时按 `updatedAt` 相等短路、跳过未变大 blob 的 `stableStringify`。
- **置信度**:0.78
- **校正(对抗性核验)**:(1)read-merge-write 放大在 **Electron 主进程**(canvas storage),非 renderer 主线程;"数十 ms 主线程阻塞"应为"主进程事件循环阻塞",且在 per-workspace 保存锁下分散于多个 await,非单次同步冻结。(2)写侧部分有界——`writeCanvasFullV2` 按 `updatedAt` 仲裁、只重写变更 node;无界全量 parse 在**读/merge 侧**(2x mergeExternalNodes + readOnDiskNodeMap + seedPerNodeContent),仍是 3-4 次全读。

### 1.6 [low] mermaid 渲染在每次 chat re-render 用 `host.innerHTML` 写裸 SVG,无 per-message 已完成图缓存
- **文件:行**:`apps/canvas-workspace/src/renderer/src/components/chat/utils/mermaid.ts:55`
- **类别**:runtime(资源/重解析)
- **证据**:已核对——`renderInto`(55-70)在 async `mermaid.render()` 后 `host.innerHTML = result.svg;`。防重渲仅靠 DOM 属性:`renderMermaidIn`(83-92)选 `.chat-mermaid[data-rendered="false"]` 并翻 `host.dataset.rendered = 'pending'`。`ChatMessage.tsx:233-237` 在 `[assistantHtml, userHtml, isStreaming]` 的 useEffect 调 `renderMermaidIn`。问题:`assistantHtml` 每次内容变都被 `renderMdWithMentions` 重生成,消息 body innerHTML 被替换 → 已渲 SVG host 被销毁重建为 `data-rendered="false"` → 对同一 diagram 源的 `mermaid.render()` 从头重跑。无以源字符串为 key 的缓存。keep-alive 多 mount 或任何重置 innerHTML 的 re-render 都触发每个 mermaid 块重解析。
- **影响**:含 mermaid 的消息,任何重建 HTML 的后续 re-render(流式完成后的后续 token、主题切换、keep-alive 重 mount)对未变 diagram 触发完整 parse+layout+SVG-serialize。`mermaid.render` 是最贵操作之一(dagre/elk 布局),异步不阻首屏但落地时 jank。
- **估算**:每次冗余重渲省 ~50-300ms(**估算**)。
- **修复**:在 mermaid.ts 加模块级 `Map<string, string>`,key 为 trim 后源 → 渲染 SVG;`renderMermaidSource` 在 `loadMermaid()`/`render` 前查缓存。源跨重渲稳定,使重渲降为 O(1) innerHTML 赋值。
- **置信度**:0.6

### 1.7 [low] 大图粘贴/拖入在主线程同步 decode+re-encode,再落盘前来回 base64
- **文件:行**:`apps/canvas-workspace/src/renderer/src/utils/downscaleImage.ts:19-46`
- **类别**:runtime / 主线程阻塞
- **证据**:`saveImageBlob`(`noteImageInsert.ts:36-46`)先 `blobToBase64`(FileReader.readAsDataURL → 内存 base64)再 `downscaleImageBase64`。downscaleImage.ts 用 `img.src = 'data:…;base64,…'` 解码、`document.createElement('canvas')` + `ctx.drawImage` 栅格、`canvas.toDataURL(type, quality)` 重编码——主线程同步 decode+raster+re-encode,仅当最长边 > 1600px 触发。
- **影响**:大粘贴(4000×3000 截图 ≈ 5-12 MB blob → ~7-16 MB base64)时,renderer 瞬时持 base64 + 解码 bitmap + 重编码 dataURL,`toDataURL` 重编码阻主线程(jank/掉帧)。持久化形式是 file ref(良好,saveImage 落盘存 filePath),故为瞬时尖峰而非 state bloat。
- **估算**:每次大粘贴 50-300 ms 主线程阻塞;~2-3x 源图瞬时内存(**估算**)。
- **修复**:decode/downscale 移出主线程——`createImageBitmap` + `OffscreenCanvas`(worker 或 `convertToBlob`)替代 img+canvas+toDataURL;Blob 直传 worker,不先序列化为 base64。
- **置信度**:0.6
- **校正(对抗性核验)**:降为 low。decode+re-encode 仅经 **note-editor 路径** `useFileNodeEditor.ts → saveImageBlob`(`noteImageInsert.ts:40`)且仅 > 1600px 触发;`useCanvasImagePaste.ts:173-191` **不** downscale/re-encode、**不**做两遍 FileReader(只 1 次 `readAsDataURL` + 1 个复用该 dataUrl 测尺寸的 `new Image()`)。原 finding "两遍 FileReader 翻倍分配"错误。真实问题仅:大图 downscale 在主线程同步重编码(无 OffscreenCanvas/worker),用户显式手势上的一次性 per-paste 尖峰。

### 1.8 [low] `restoreLocalImageMarkdown` 每次内容加载用 TreeWalker 遍历整个编辑器 DOM
- **文件:行**:`apps/canvas-workspace/src/renderer/src/hooks/useFileNodeEditor.ts:68-106,136-138`
- **类别**:runtime / state-bloat 向量
- **证据**:`MarkdownSafeImage.parse.updateDOM` 调 `restoreLocalImageMarkdown(element)`(137),后者 `document.createTreeWalker(element, NodeFilter.SHOW_TEXT)` 遍历整篇笔记,对每个含 `![` + 本地提示的文本节点跑全局 `FILE_IMAGE_MARKDOWN_RE`(只匹配 `file://`/`pulse-canvas://`)并重建 DOM 片段。每次 markdown parse(即每次 load/setContent)触发。正则只匹配 file/pulse-canvas → 确认粘贴的 `data:` URI 非持久化形式(`saveImageBlob` 总落盘并插 file ref)。
- **影响**:大笔记每次加载全文 TreeWalker + 每候选文本节点正则(数 ms),并被画布打开时多 file 节点同时 mount 的无 culling 扇出放大。low——持久化是 file ref 非内联 base64,属加载 CPU 非 state bloat。残留:外部导入的已含 `data:image/*` 的 markdown 会绕过 file-ref 路径内联存进 `node.data.content`。
- **估算**:大笔记加载数 ms,被同时多节点 mount 放大(**估算**)。
- **修复**:在编辑器层用 `LOCAL_IMAGE_HINT_RE` 对全文做廉价预检后再 walk,无本地图提示则整体跳过;另加守卫:加载时把入站 `data:image/*` 转存为 file ref,防导入笔记内联 base64 进 state。
- **置信度**:0.6

---

## 二、首屏渲染 (启动到首个可用画面的关键路径)

### 2.1 [high] 默认首启画布在首屏关键路径上挂载指向外部 URL 的 live `<webview>`(guest 进程 + 网络导航)
- **文件:行**:`apps/canvas-workspace/src/main/canvas/welcome-workspace.ts:205-220`;`apps/canvas-workspace/src/renderer/src/components/IframeNodeBody/useIframeNodeState.ts:101-118`
- **类别**:first-paint
- **证据**:welcome-workspace.ts 作为**唯一**默认工作区(`WELCOME_WORKSPACE_ID = 'default'`)seed 一个 iframe 节点 `node-welcome-download`,`data: { url: DOWNLOAD_URL, mode: 'url' }`,`DOWNLOAD_URL = 'https://pulse-canvas-download.pages.dev/'`(第 15 行),尺寸 `width: 1191, height: 1369`。mount 时 `useIframeNodeState` 的 **`useLayoutEffect`**(101)在 paint 前同步跑:`const webview = document.createElement('webview'); … webview.setAttribute('src', url); host.appendChild(webview);`——外部导航在 layout effect(阻 paint)里首次 Canvas mount 即发起。CanvasSurface 无 culling(`renderGroups.regular.map((node) => renderNode(node))`,`CanvasSurface.tsx:266`),seed 的 `scale: 0.5567` + 位置使该节点启动即在视口内,Electron 附加独立 guest WebContents 进程并开始拉取/解析/绘制外部站点,计入 time-to-first-usable-frame。
- **影响**:全新安装的首个有意义绘制被 gate 在:(a)为 guest 起第二个 Chromium renderer 进程;(b)对外部 Cloudflare Pages 站点的 DNS+TLS+HTTP 往返(网络相关、无界——离线用户看到 load-error 卡闪现);(c)1191×1369 表面的 GPU tile 分配。这些都非用户操作画布所需的 app shell,是 onboarding chrome。这是冷启路径上最重的单项且完全外部不可控。
- **估算**:guest 进程 spawn + 外部 fetch + 嵌入页首绘制通常给冷启 interactive 加数百 ms 到 >1s,网络相关;延迟挂载可移除几乎全部 TTFMP(**估算**)。
- **修复**:延迟 `<webview>` 挂载到首屏之后/节点进入视口后。初始 mount 渲染轻量静态占位(下载页缩略图,或带 URL + "Load" 的卡片);首次 IntersectionObserver 命中或 `requestIdleCallback` 后再创建真 `<webview>`。现有 `webviewHostRef` + `webviewKey` 重 mount 机制已支持后挂载——在 layout effect 里用 `hasBecomeVisible` ref gate 住 `document.createElement('webview')` 而非无条件运行。
- **置信度**:0.8

### 2.2 [medium] 窗口/HTML 加载被串行卡在 4 步 async 链(seeding + 工具环境 + 内建插件 + 外部插件)之后才 `openWindow()`,无任何工作与 renderer 下载/解析/首绘重叠
- **文件:行**:`apps/canvas-workspace/src/main/app/bootstrap.ts`(106 / 135 / 163 / 164 / 191)
- **类别**:first-paint
- **证据**:已核对——`app.whenReady()` 中:第 106 行 `await ensureWelcomeWorkspaceSeeded()`、第 135 行 `await applyStoredBuiltInToolsConfigToEnv()`、第 163 行 `await setupCanvasPlugins(BUILT_IN_MAIN_PLUGINS)`、第 164 行 `await reloadConfiguredExternalMainPlugins()` 顺序 resolve,之后第 191 行才 `openWindow()`(→ `createWindow` → `win.loadFile(rendererIndexPath)`)。在这些 await 完成前不构造任何 BrowserWindow,renderer 无法开始下载/解析 `main.tsx` 或绘制 `index.html` 的零-JS boot-screen(`.boot-screen` "Preparing workspace")。
- **影响**:TTFP 被 seeding + env apply + 内建插件 activate() + 外部插件 `import()` 的总时长推后;冷启期间 OS 整段不显示任何窗口(连 boot skeleton 都没有)。
- **估算**:内建插件激活 + 外部 import() 通常数十至数百 ms,首启 seeding 叠加磁盘 I/O;串行链是本维感知延迟的主导可避免项(**估算,负载相关**:无外部插件时近零,有外部插件或某内建 activate() 做 I/O 时显著)。
- **修复**:**先**构造 BrowserWindow 并 `loadFile`(紧随首批 IPC 往返所需的 handler 注册之后),再**并发**跑 seeding/env/内建/外部插件,期间 renderer 下载/解析并绘制 boot-screen。renderer 首个 `canvas:load` IPC 可 `await` 单个 `mainReady` promise 以保序。
- **置信度**:0.78
- **校正(对抗性核验)**:第 163 行 await 部分 load-bearing(代码注释:canvas-agent 工具注册表须在 renderer 首个 canvas-agent IPC 前填好),故修复需"早构造/加载窗口、但在 agent IPC 被触发前完成插件注册",而非盲目把全部重排到 `openWindow()` 之后。

### 2.3 [medium] 重节点 body 模块(xterm、Tiptap+18 扩展、highlight.js/lowlight、webview 接线)被静态 import 进 DefaultCanvasNode,落入启动 chunk——0 个 React.lazy 边界
- **文件:行**:`apps/canvas-workspace/src/renderer/src/components/CanvasNodeView/DefaultCanvasNode.tsx:12-19`;`hooks/useFileNodeEditor.ts:1-36`;`components/TerminalNodeBody/index.tsx:3-4`
- **类别**:frontend-assets / first-paint
- **证据**:见 §1.1 / §1.4。DefaultCanvasNode 从 `App.tsx` 同步 import 链可达,全 renderer 无 `React.lazy()`,故 xterm、完整 Tiptap/ProseMirror 栈、tiptap-markdown、highlight.js-common 全被拉进首屏 JS chunk 并在画布渲染前于主线程 parse+eval。
- **影响**:即使工作区零 file/terminal 节点,启动 bundle 也须解析+求值 xterm、Tiptap 栈、highlight.js-common,均在首绘前于主线程跑。
- **估算**:Tiptap+ProseMirror ~300-500KB min、xterm ~150-250KB min、highlight.js common ~250-400KB min,合计约 0.7-1.1MB 与纯文本/图形/图片画布无关的 JS(**估算,偏高**)。
- **修复**:每个重 body 包 `React.lazy` + `Suspense`(占位框作 fallback),只加载实际存在节点类型的 chunk;`createLowlight(common)` 换 curated 子集;`electron.vite.config.ts` 加 `manualChunks` 拆 xterm/tiptap/lowlight/force-graph 为独立 vendor chunk。
- **置信度**:0.8
- **校正(对抗性核验)**:Electron 应用 renderer JS 从本地 `file://` 加载,**无网络下载**,~0.7-1.1MB 含下载的估算被高估;真实代价仅首绘前主线程 parse+eval。统计为 **8** 个静态 body(非 6)。严重度从隐含 high 降为 medium。

### 2.4 [medium] 首绘时同步构造两个 Tiptap 编辑器,各 eager 拉入注册全部 `common` 语言的 lowlight/highlight.js
- **文件:行**:`apps/canvas-workspace/src/renderer/src/hooks/useFileNodeEditor.ts:16-18,36`;`apps/canvas-workspace/src/main/canvas/welcome-workspace.ts:189-204,221-236`
- **类别**:first-paint
- **证据**:welcome 工作区 seed **两个** `type: 'file'` 节点(`node-welcome-note`、`node-welcome-detail`,seed transform 下均在视口)。`DefaultCanvasNode.tsx:222` 各渲为 `<FileNodeBody>`,调 `useFileNodeEditor` → `useEditor(...)`(@tiptap/react)mount 时同步。扩展集重且静态(StarterKit、Image、Table*×4、TaskList/TaskItem、Link、Underline、Highlight、Markdown、`CodeBlockLowlight`),`const lowlight = createLowlight(common)`(已核对第 36 行)在启动 chunk 求值期运行;首次 Canvas mount 中构建两次完整 Tiptap ProseMirror schema+view。无 React.lazy 边界。
- **影响**:冷启在主线程同步:模块加载时求值 `createLowlight(common)`(~35 语法对象注册),再构造两个完整 Tiptap 实例(schema compile + EditorView mount + seed 笔记的 markdown parse)。纯主线程阻塞、无 yield,与上 §2.1 webview spawn 争同一首帧。
- **估算**:lowlight `common` 低数百 KB 语法在启动解析;两次同步 Tiptap mount 各数十 ms 主线程(**估算**;对抗核验:`common` 注册约 37 个语法定义对象属"注册/装配"非"解析数百 KB",真实代价为注册 + 两次同步 EditorView mount + markdown parse,合计数十 ms,scoped 到首个画布绘制及后续含 file 节点的工作区加载,非全 app-shell 阻塞)。
- **修复**:(1)`createLowlight(common)` → curated 小语言集;(2)lazy 编辑器——初始渲染笔记 markdown 为静态 HTML/纯文本,`useEditor` 仅 focus/intersection 时实例化(`React.lazy` FileNodeBody 编辑子树,或 `isActive` flag gate);(3)`manualChunks` 把 @tiptap+lowlight 拆出 entry chunk。
- **置信度**:0.8

### 2.5 [low] 插件激活 gating 论据(注释 159-162)强于首绘所需;agent service 已更早构造,工具注册只在首轮需要
- **文件:行**:`apps/canvas-workspace/src/main/app/bootstrap.ts`(注释 159-162,await 163)
- **类别**:first-paint
- **证据**:已核对——注释(159-162)称须在 `openWindow` 前 await `setupCanvasPlugins`,因"插件激活可注册 canvas-agent 工具;需在任何 canvas-agent 被构造前完成(发生于 renderer 首次调 canvas-agent IPC)"。但 `CanvasAgentService` 早已构造:`setupCanvasAgentIpc()`(bootstrap:118)→ `getService()` → `getCanvasAgentService()` → `service = new CanvasAgentService()`(`agent/ipc.ts:52-54,64`)。故插件运行时单例已存在——该 await 保护的"工具先于构造"顺序并未由它达成。真正须先于的是**首个 agent turn**,仅在用户打开 chat 并发消息后,远晚于首绘。
- **影响**:阻塞窗口创建于插件激活的最强论据不成立:在首轮前(而非窗口打开前)注册插件工具工厂即足够。把该 await 留在关键路径,是为一个已在别处满足或更晚才需要的正确性保证付首绘延迟。
- **估算**:从首绘关键路径回收内建+外部插件激活时间(数十至数百 ms),agent turn 行为不变(**估算**)。
- **修复**:把 `setupCanvasPlugins`/`reloadConfiguredExternalMainPlugins` 移出 pre-openWindow 路径;让 `CanvasAgentService` 在 turn-start 懒装配插件工具工厂(已按需读 `getRegisteredCanvasToolFactories()`),gate 于 plugins-ready promise。
- **置信度**:0.7

### 2.6 [low] `reloadConfiguredExternalMainPlugins` 在窗口打开前同步 await 每个外部插件的 `import()`
- **文件:行**:`apps/canvas-workspace/src/plugins/main/external.ts`(bootstrap.ts:164)
- **类别**:first-paint
- **证据**:bootstrap.ts:164 `await reloadConfiguredExternalMainPlugins()` → `loadExternalMainPluginEntries` 循环 `const mod = await import(moduleUrl)`(external.ts:53)每插件,再 `await setupCanvasPlugins(plugins)`(27)逐个 `await plugin.activate(...)`(registry.ts:60)。外部插件付完整模块 parse+evaluate(不同于静态 import 的内建)。
- **影响**:每个用户装的外部主插件把 import()+activate() 延迟直接加到 TTFP,无界扇出(每插件一额外 await 轮);N 个插件 → 启动延迟随插件数线性,首帧均不需要。
- **估算**:每外部插件 import()+activate 加低数十 ms;N 插件 → N×该值,全串行(**估算**)。
- **修复**:把 `reloadConfiguredExternalMainPlugins` 整体延迟到 `openWindow()` 之后,resolve 进与 agent turn await 的同一 plugins-ready promise(同 §2.5)。
- **置信度**:0.55

### 2.7 [low] main.tsx 静态 import module-federation runtime 并在 bootstrap(首次 React render 前)触发联邦插件加载
- **文件:行**:`apps/canvas-workspace/src/renderer/src/main.tsx`(7-11,24);`src/plugins/renderer/federation.ts`(1-5,103-110,300-307)
- **类别**:first-paint / frontend-assets
- **证据**:main.tsx 7-11 静态 import `../../plugins/renderer`(再导出 `activateConfiguredFederatedRendererPlugins`),federation.ts 1-5 静态 import `@module-federation/runtime` + 完整命名空间 `import * as React/ReactDom/ReactDomClient/ReactJsxRuntime`,整个 MF runtime 进 entry chunk。main.tsx:24 `void activateConfiguredFederatedRendererPlugins().catch(...)` 在 bootstrap 发 async IPC `canvasWorkspace.canvasPlugins.list()` 并 `ensureFederation()` → `init({...})`——即便零联邦插件配置(内建 mock-node remote 总注册),也在主线程与首绘并发调度。
- **影响**:MF runtime parse/eval 在 entry chunk 每次冷启付;bootstrap 还调度与首渲染争主线程的 IPC 往返 + federation init()。唯一预绘所需的内建 renderer 插件 `DevtoolsRendererPlugin` 根本不需 MF。
- **估算**:`@module-federation/runtime` ~30-60KB min 在 entry chunk;外加首绘窗口内一次 async IPC + init()(**估算**)。
- **修复**:延迟 federation——main.tsx 同步调 `activateCanvasPlugins(BUILT_IN_RENDERER_PLUGINS)`(廉价,无 MF),在 `createRoot().render()` **之后**于 `requestIdleCallback`/微任务里 `import('../../plugins/renderer/federation')`,让 runtime 离开 entry chunk;先判断是否配置了联邦 spec 再拉 runtime。
- **置信度**:0.8

### 2.8 [low] I18nProvider 在首渲染 eager import 含 en+zh 双表的单个 2377 行 messages 模块
- **文件:行**:`apps/canvas-workspace/src/renderer/src/i18n/messages.ts`(`i18n/index.tsx:13,68`;`App.tsx:597`)
- **类别**:frontend-assets / first-paint
- **证据**:`i18n/index.tsx:13` import `messages`,I18nProvider(`App.tsx:597`,最外层 provider)读 `messages[language][key]`(index.tsx:68)。messages.ts 单文件 2377 行,含完整 `en`+`zh` 词典。`getInitialLanguage()`(36-45)只选一种语言,但两张全表都在启动 chunk,无 per-language 拆分。
- **影响**:非激活语言整张串表每次首绘被解析(纯浪费);大对象字面量在 entry eval 时于主线程解析。
- **估算**:非激活语言表约占 2377 行字面量一半,延迟它移除约该量串解析(**估算**)。
- **修复**:拆 `messages.en.ts` / `messages.zh.ts`;同步加载激活语言(或内联 `en` 作 fallback),`setLanguage` 切到另一语言时才 `import()`。`en` eager(index.tsx:68 的 fallback),`zh` lazy。
- **置信度**:0.85

### 2.9 [low] 首启 welcome seeding 在窗口打开前完整执行 mkdir + 2×writeFile + saveCanvas + manifest 写
- **文件:行**:`apps/canvas-workspace/src/main/canvas/welcome-workspace.ts`(270-289;`service.ts:39-65`)
- **类别**:first-paint
- **证据**:`ensureWelcomeWorkspaceSeeded`(bootstrap.ts:106 await)在冷启路径同步 await 磁盘 I/O:`await fs.mkdir(notesDir, …)`(270)、两次 `await fs.writeFile(...)`(271-272)、`await saveCanvas(...)`(274)、`await writeWelcomeManifest(...)`(289)。非首启 `listWorkspaces` 提前返回(260 `if (existing.workspaces.length > 0) return`),仅首启付。
- **影响**:冷首启 OS 窗口被 ~4-5 串行 fs 操作延迟;warm SSD 数 ms,冷文件缓存/慢/网络 home 目录下数十 ms,且与链其余部分严格串行,renderer 期间无法绘制 boot-screen。
- **估算**:从 pre-window 路径移除数十 ms 仅首启 fs 延迟(**估算**)。
- **修复**:`openWindow()` 后并发跑 seeding;renderer 初始 `canvas:load` await seeding promise(本就需处理空/刚建工作区)。"Preparing workspace" boot-screen 文案正为此设计。
- **置信度**:0.5
- **校正(对抗性核验)**:`saveCanvas` 的"额外 readCanvasFull 空写守卫"仅当 `data.nodes.length === 0` 运行;welcome 画布 seed 了 3 个节点(WELCOME_NOTE/DOWNLOAD/DETAIL),故守卫被**跳过**,无额外读。真实成本 = 1 mkdir + 2 writeFile + 1 canvas 写 + 1 manifest 写 ≈ 4 次小写、无读。且相对同链后续更重的 `await setupCanvasPlugins/reloadConfiguredExternalMainPlugins`(163-164),seeding 占 pre-window 延迟一小部分,且 app 生命周期仅首启跑一次。

---

## 三、运行时 (稳态 CPU/内存/响应性,侧重第一轮 culling 议题未覆盖的盲区)

### 3.1 [medium] Background throttle 只降帧——offscreen webview 的 JS/timer/fetch/WebSocket 永远全速运行
- **文件:行**:`apps/canvas-workspace/src/renderer/src/components/IframeNodeBody/useWebviewBackgroundThrottle.ts`(84;`registry.ts:545`)
- **类别**:runtime-cpu
- **证据**:hook 对 throttled webview 的**唯一**作用是 `api.setFrameRate(workspaceId, nodeId, rate)`(84)→ 主进程 `wc.setFrameRate(clamped)`(registry.ts:545)。hook 自身注释(7-10)明示:"guest 进程存活——JS、timers、网络、页内 state 全保留"。`setFrameRate` 在 Chromium 只管合成器 paint/raster tile 节奏,不暂停 guest JS 事件循环、`setInterval/setTimeout`、fetch、XHR、WebSocket。故 offscreen 的 Figma/dashboard/video 节点仍无限烧 CPU 于页内 timer 与网络轮询并持完整堆。
- **影响**:CPU 底噪随**活动内容** link 节点数线性,与可见性无关;多个自刷新 dashboard 节点 → N 个后台 renderer 的等效主线程工作,耗电、与前台画布争核。
- **估算**:单个自刷新 dashboard SPA 每 offscreen 节点稳态持 1-5% CPU;多个 → 多核百分点后台底噪(**估算**)。
- **修复**:深度 offscreen 节点升级超越降帧:较长宽限期后导航 guest 至 about:blank 并持久化 URL 以恢复,或超时后整体 unmount guest(同 culling 的 mount-gating)。纯 setFrameRate 不足以回收 CPU/网络,注释亦确认此为设计取舍。
- **置信度**:0.7
- **校正(对抗性核验)**:机制被高估——rAF **并非**不受影响:Chromium `setFrameRate` 把 rAF 回调投递降到设定帧率(~1fps),故 rAF 驱动的动画/轮询会减慢。准确说法:`setInterval/setTimeout/fetch/XHR/WebSocket` 继续全速(timer 队列/网络驱动,与合成帧率无关)。且这是为保留 guest state 的**刻意文档化取舍**,是否应"修"存疑。

### 3.2 [medium] 切换可见性 toggle(showTags/showLinks/showWorkspaceHubs/showOffCanvas/density)重启全节点/链的 12s 主线程 d3 物理仿真
- **文件:行**:`apps/canvas-workspace/src/renderer/src/components/WorkspaceNodes/GraphPage.tsx`(409-430,424,430,776)
- **类别**:runtime
- **证据**:layout effect(409-430)以 `graph.d3ReheatSimulation()`(424)结尾,key 为 `[graphData.links.length, graphData.nodes.length, layoutPreset]`(430)。`cooldownTime={12000}`(776)且**无** `cooldownTicks` → reheat 后 sim 跑满 12000ms wall-clock。`graphData` 由 `buildGraphData`(108-199)在 `[showLinks, showTags, showWorkspaceHubs, tags, t, visibleNodes, workspaces]`(337-346)useMemo 重建;`visibleNodes` 依赖 `showOffCanvas`(279-282)。toggle 这些改变 node/link **计数** → 改 `graphData.{nodes,links}.length` → 重触 effect → reheat → 新 12s 力 tick。d3-force 在主线程(无 web-worker offload)。
- **影响**:每次 toolbar toggle 最多 12 秒持续主线程物理(每 tick O(nodes+links),charge 无 Barnes-Hut 调优时 O(n²)),期间 rAF 重绘亦活;快速 toggle 叠加 reheat;此窗口内 UI 交互与 sim 争主线程,致输入卡顿/掉帧。
- **估算**:每 toggle 12s wall-clock 物理;~500 节点下每 reheat 数秒累计主线程时间(**估算**)。
- **修复**:设有界 `cooldownTicks`(如 100-200)替代/补充 `cooldownTime`,使 sim 在固定工作量后确定停止;debounce toggle;reheat effect 别纯以 length delta 为 key,标签/链 toggle 只增叶节点时增量 re-warm 而非全 reheat。
- **置信度**:0.8

### 3.3 [medium] 全局 workspaceNodes onChange 重载所有工作区节点,可在无关编辑上重热仿真
- **文件:行**:`apps/canvas-workspace/src/renderer/src/components/WorkspaceNodes/useWorkspaceNodes.ts`(123-129,73-114)
- **类别**:runtime
- **证据**:`useAllWorkspaceNodeList` 注册 `api.onChange(() => { void reload(); })` **无工作区过滤**(123-129)——不同于 `useWorkspaceNodeList` 过滤 `event.workspaceIds.includes(workspaceId)`(50-58)。`reload`(73-114)`Promise.all(workspaces.map(...api.list...))` 重取**每个**工作区,建新身份 `nextNodes` 调 `setNodes`。GraphPage 中 `nodes` → `visibleNodes`(新数组,279-282) → `graphData` useMemo 重算(337-346);若改了 node/tag/link 计数,`length` 变 → reheat effect(430)再触 12s sim。agent 的 `canvas_tag_node` 与任何画布编辑都发此事件,**任一**工作区贴一个 tag 即重列**所有**工作区并可能重热图物理。
- **影响**:图视图打开时,任一工作区的后台 agent 活动或编辑触发全多工作区 re-list(N 个 IPC 往返 + 全数组重建)外加可能 12s reheat,即便该工作区不贡献可见变更。由外部事件驱动的稳态 churn,非用户交互。
- **估算**:每变更事件一次全 N 工作区 `api.list` 扇出;计数变则 reheat 加最多 12s(**估算**)。
- **修复**:`useAllWorkspaceNodeList` 的 onChange 按 `event.workspaceIds` 与已加载 workspaces 是否相交过滤,并 debounce/coalesce 快速事件;更优:diff 新节点列表,仅拓扑实变时 `d3ReheatSimulation()`,解耦 re-fetch 与 re-warm。
- **置信度**:0.8
- **校正(对抗性核验)**:从隐含 high 调为 medium——仅 Graph/Nodes 视图 mount 时、仅 knowledge-tag 变更事件触发,非每次画布保存/流式 tick,属 gated/bounded 而非持续热路径。

### 3.4 [medium] mermaid.render() 在 renderer 主线程同步、无 worker offload——含图回复在流式完成瞬间 jank
- **文件:行**:`apps/canvas-workspace/src/renderer/src/components/chat/utils/mermaid.ts:41-53,55-70,83-92`;`ChatMessage.tsx:233-236`
- **类别**:runtime
- **证据**:已核对——`renderMermaidSource` `const { svg } = await mermaid.render(id, trimmed);`(47)。虽 await,`mermaid.render` 内部 CPU 同步:在调用(主)线程解析 DSL + 跑 dagre/ELK 布局 + SVG 串装配,**无 Web Worker**。`renderMermaidIn`(83-92)遍历每个 pending host 触发 `void renderInto(host)`,无并发上限/分块,一条消息所有图背靠背渲染。`ChatMessage` gate 于流末:`useEffect(() => { if (isStreaming) return; renderMermaidIn(bodyRef.current); }, [assistantHtml, userHtml, isStreaming])`。`isStreaming` 守卫对可解析性正确,但意味含 N 图回复在流完成瞬间把 N 个 host 一起翻转并在单串行 burst 中渲染,恰逢 token 流重渲压力 + 末次绘制落同一画布线程。
- **影响**:每个非平凡流程图/时序图约 30-150ms 阻塞主线程布局;3 图回复 → 流完成时 ~90-450ms jank(画布掉帧、chat 滚动冻结、PTY/IPC delta 停滞)。画布、force-graph rAF、chat 共用此一 renderer 线程,故 stall 是全窗口的(**估算**)。
- **修复**:图间 yield 摊销 burst——每图一 rAF/idle 回调(`requestAnimationFrame` 或 `scheduler.postTask`);更优把 parse+layout 移线程外(专用 Worker 跑 render 并 postMessage SVG 串回,主线程只 `host.innerHTML`);至少限并发并优先视口内 host。
- **置信度**:0.78

### 3.5 [medium] 首个图付多百 ms 的 `import('mermaid')` + initialize 主线程 stall——renderer 唯一代码分割点
- **文件:行**:`apps/canvas-workspace/src/renderer/src/components/chat/utils/mermaid.ts:15-29`
- **类别**:first-paint(运行时首遇)
- **证据**:已核对——`import('mermaid').then(mod => { const m = mod.default; m.initialize({...}); return m; })`(17-26)。文件自注释:"mermaid bundle 约 1MB"。这是 renderer 唯一代码分割边界(grep 确认 renderer 源唯一运行时 `import(` 即此;`App.tsx:324` importWorkspace 与 `CanvasRootView.tsx:76` 是函数调用/类型,非模块加载)。`loadMermaid` 由 `renderMermaidSource`(45)懒触,后者为 ChatMessage `renderMermaidIn`、`ChatInlineVisual`(168)、ArtifactTabView `ArtifactMermaid`(161)共享入口。故首个 chat 图 / 首个 mermaid inline visual / 首个 artifact 抽屉图——孰先——触发一次性模块 parse+evaluate + `mermaid.initialize`。
- **影响**:首遇图为多百 ms 主线程 stall:~1MB JS(mermaid + dagre/d3)须磁盘读取、解析、求值,再 initialize,全在首个 SVG 出现前。因懒落地于会话中段(非启动),用户感知为首次任何图浮现时的突然冻结,期间画布与 chat 无响应。懒边界本身正确(挡出启动 chunk),但无预热。
- **估算**:~1MB bundle(注释),多百 ms parse+init 首遇(**估算**)。
- **修复**:保留懒边界但首屏外预热——idle 时(`requestIdleCallback` 首绘后)或检测到流式部分内容已含 ` ```mermaid ` fence 时投机 `loadMermaid()`,使 import 与流重叠;考虑 tree-shake 到仅支持的图类型(flowchart/sequence)削减 ~1MB parse。
- **置信度**:0.78

### 3.6 [low] iframe 类节点 body(DynamicApp、artifacts、AI/HTML 预览)无帧率限流——只有 URL-mode `<webview>` 有
- **文件:行**:`apps/canvas-workspace/src/renderer/src/components/DynamicAppNodeBody/index.tsx:147-152`(`useIframeNodeState.ts:274,106`;`IframeRenderedView.tsx:180-190`)
- **类别**:runtime / 浪费 GPU
- **证据**:`useWebviewBackgroundThrottle` 仅从 `useIframeNodeState`(274)调用且 `disabled: editing || mode !== 'url'`——它控制 Electron `<webview>`(setFrameRate),仅 URL mode 存在(`document.createElement('webview')` 于 useIframeNodeState.ts:106)。DynamicAppNodeBody 渲普通 `<iframe src=... sandbox=...>`(index.tsx:147),IframeRenderedView 经 `<iframe srcDoc=...>`(180-190)渲 html/ai/artifact。这些 `<iframe>` 路径均不调 throttle hook、不注册 webview,普通 iframe 无 setFrameRate 等价物。故 dynamic-app guest 与 AI/HTML 预览 iframe 不论视口位置始终全速绘制。
- **影响**:带 CSS 动画/JS rAF 的 dynamic-app 或 AI 视觉即便远滚出画布仍全帧率绘制,无 IntersectionObserver gating。结合无 culling 渲染扇出(第一轮),每个此类节点是常驻、始终绘制的渲染面。
- **估算**:每个动画 iframe 节点 ≈ 一个持续全速合成器面(**估算**)。
- **修复**:扩展 offscreen 限流到 iframe 节点——IntersectionObserver gate,远 offscreen 时 toggle `content-visibility: hidden`/`visibility:hidden` 或 unmount iframe(srcDoc/artifact 内容从 state 重 mount 廉价);dynamic-app iframe 可 postMessage 暂停 runner。
- **置信度**:0.7

### 3.7 [low] `linkDirectionalParticles` 击败 react-force-graph 的 autoPauseRedraw,hover/active 期间钉死永久 60fps rAF
- **文件:行**:`apps/canvas-workspace/src/renderer/src/components/WorkspaceNodes/GraphPage.tsx`(773,775,364-377,755-757)
- **类别**:runtime
- **证据**:773 `linkDirectionalParticles={(link) => link.kind !== 'workspace' && highlighted.linkIds.has(linkKey(link)) ? 2 : 0}` + `linkDirectionalParticleSpeed={0.005}`(775)。`highlighted`(364-377)以 `hoverNodeId || activeNodeId` 为 key,`onNodeHover`(755-757)每 pointer-over 设 `hoverNodeId`。react-force-graph-2d 默认 `autoPauseRedraw=true`(sim 冷却后停 rAF),**但** directional particles 须每帧推进重定位,故任何发射 particle 的 link 让 rAF 持续运行,即便布局已冷。未设 `autoPauseRedraw={false}`,属隐式/意外。净:hover 一节点 → 其相连 link 各得 2 动画 particle → rAF ~60fps 持续(只要光标停留),每帧重绘**整个**画布(全 node+link),非仅 particle。
- **影响**:普通 hover 触发的稳态主线程 CPU 烧(~60fps 全画布重绘),无运动、布局已定。大跨工作区图上为装饰性 2-particle 动画持续吃 ~16ms/帧预算;与 per-node measureText 热路径(§3.8)叠加,使每次 hover 成 O(nodes) 每帧成本。
- **估算**:hover 时 ~60fps × 全画布重绘;500 节点 + ~1000 链每帧重描全链 + 全 node renderNode,~5-15ms/帧(**估算,未 profiling**)。
- **修复**:(a)highlight 弃用 `linkDirectionalParticles`,改静态 dashed/染色 link(`linkColor`/`linkLineDash`,不强制持续重绘);或(b)particle 后置于用户设置并适配 `autoPauseRedraw`。最干净:移除 particle,highlight 已由 `linkWidth`/`linkColor`(767-772)传达。
- **置信度**:0.62
- **校正(对抗性核验)**:`cooldownTime={12000}` 存在于 776("无 cooldown/autoPauseRedraw prop"说法不实;cooldownTime 管 sim 非 particle rAF,核心机制仍成立)。影响被高估为"普通 hover 永久稳态烧":须**活动 hover 或持久节点选择(activeNodeId)**,非无交互 idle。activeNodeId 持久化才是真正可虑情形。500/1000 数字为假设/未 profiling。严重度应为 low。

### 3.8 [medium] renderNode 在 rAF 活跃时对每个节点每帧跑 ctx.save + measureText + roundRect + fillText
- **文件:行**:`apps/canvas-workspace/src/renderer/src/components/WorkspaceNodes/GraphPage.tsx`(481-561,777)
- **类别**:runtime
- **证据**:`renderNode`(481-561)作 `nodeCanvasObject`(777),被 force-graph 对**每节点每帧**调。每节点 `ctx.save()`(503)、设字体(523)、`ctx.measureText(label).width`(524)、`ctx.roundRect(...)`(532-539)、`ctx.fillText(...)`(557)、`ctx.restore()`(560)。`shouldShowLabel` 在 `showLabels`(默认 `true`,218)时为真——故默认每节点每帧测量并绘标签。`measureText` 是公认 canvas 热路径(强制文本 shaping)。无 per-node 标签宽 memo;固定 zoom 下标签与 fontSize 极少帧间变化却每帧从头重算宽度。
- **影响**:rAF 被 particle(§3.7)或 reheat(§3.2)钉活时,这是 O(nodes) 文本 shaping + 圆角矩形填充 @~60fps。500 节点图每帧 ~500 measureText + 500 roundRect 纯为标签,主导每帧成本并放大 §3.7/§3.2。
- **估算**:每节点每帧 ~2 canvas 文本操作;500 节点 × 60fps ≈ 60k measureText/s 持续(**估算,未 profiling**)。
- **修复**:per-(label, 分桶 fontSize) 在 ref-Map 缓存测量宽度跨帧复用;低于 zoom/scale 阈值跳过标签渲染(519 有部分 `globalScale > 2.3` gate 但与 `showLabels` OR,showLabels 开时永不抑制);仅对 highlighted/视口内节点渲标签。
- **置信度**:0.7

### 3.9 [low] execInSession 每调注册新 onData 监听器,把全部流输出缓进无界字符串直到 marker 或 30s 超时,并发调用间串扰
- **文件:行**:`apps/canvas-workspace/src/main/terminal/pty-manager.ts:371-448`
- **类别**:runtime-memory
- **证据**:`const disposable = proc.onData((data) => { … output += data; … })`(406-441)为调用时长注册额外监听器;`capturing` 真时每 chunk `output += data` 无大小上限。终止仅 `output.includes(endMarker)`(426)或 `setTimeout(() => finish(...), timeout)`(`timeout = opts?.timeout ?? 30_000`,381,402)。若命令从不打印 end marker(长跑/流式,或 marker 被 partial-chunk 边界切断,因 `data.indexOf(marker)`(411)假设 marker 不跨 chunk),`output` 在整 30s 无界增长。Demux 仅靠 marker:`proc.write(echo ${marker}\r); proc.write(${command}\r); proc.write(echo ${endMarker}\r)` 意味同 session 多并发 `execInSession` 共享同流——每调监听器追加他调字节(串扰 + 跨 N 监听器重复增长)。
- **影响**:单个 misbehaving harness 命令持续增长字符串(chatty 30s 命令可达多 MB)外加整 timeout 内该 session 热路径多一活监听器,加每 chunk 串拼成本。并发调用同时倍增监听器数与缓冲字节。partial-chunk marker 切分可致漏 end marker,保证最坏情形。
- **估算**:最坏 ~ 输出速率 × 30s 持于单 JS 串(冗长命令多 MB),× 并发调用数(**估算**)。
- **修复**:`output` 长度封顶(超 MAX_SCROLLBACK_CHARS 切尾并停追加);marker 匹配跨 chunk 边界的滚动缓冲而非 per-chunk `indexOf`;per-session 串行化 execInSession(复用 pty-bridge 的 nodeQueues),同时只挂一个 capture 监听器,消除串扰。
- **置信度**:0.7

### 3.10 [low] pty:write / pty:resize 无流控:大粘贴整块推送;拖拽 resize 每像素一次同步 IPC + 原生 resize 系统调用
- **文件:行**:`apps/canvas-workspace/src/main/terminal/pty-manager.ts:317-334`;`apps/canvas-workspace/src/renderer/src/components/WorkspaceTerminalDock/index.tsx:124-128,318-349`
- **类别**:runtime-main-thread
- **证据**:`ipcMain.on("pty:write", (_e, p) => { const proc = sessions.get(p.id); if (proc) proc.write(p.data); })`(317-320)——`data` 一次性写入 pty 无分块,大粘贴/程序化写直通。`ipcMain.on("pty:resize", …)` (322-334) 每调一次原生 resize 系统调用。renderer 侧拖拽 resize 每 mousemove 调 `scheduleFit`:`handleResizeStart` onMouseMove(323-328)→ `scheduleFit()`,而 `scheduleFit`(124-128)每次 fit 扇成**三**调:`requestAnimationFrame(fitTerminal); setTimeout(fitTerminal, 80); setTimeout(fitTerminal, 240);`。`fitTerminal`(111-122)终于 `api.resize(...)` → `ipcRenderer.send("pty:resize", ...)`。故一次连续拖拽 → 多 mousemove × 各 3 调度 fit → 一串同步 resize IPC + 原生 `proc.resize`。ResizeObserver 路径(288-296)也直连 `scheduleFit` 无 debounce,画布 zoom 拖拽进一步放大。
- **影响**:高频拖拽 resize 终端节点用同步 IPC + 原生 resize 系统调用(各可触发子进程 SIGWINCH 重绘)淹没主进程,与同一主线程上 per-chunk data 扇出争抢;大粘贴可瞬时阻塞 pty 写路径。均为 bursty 主线程争用而非稳态泄漏。
- **估算**:1 秒拖拽 ~60 mousemove/s × 3 调度 fit ≈ 180 次 resize 尝试;按变更 cols/rows 去重 + 尾沿 debounce 降至个位数(**估算**)。
- **修复**:debounce/throttle `scheduleFit` 与 ResizeObserver 回调到尾沿——把 rAF+80ms+240ms 三连塌缩为单尾沿 fit,仅 cols/rows 实变时发 `pty:resize`;大 `pty:write` payload 分块(有界切片写)。
- **置信度**:0.6

---

## 优先修复路线图

> 标注:第一轮 P0/P1/P2 聚焦"渲染扇出"——节点无视口 culling、keep-alive 页面 eager mount、DOM 节点 fan-out。本轮路线图**不重复**这些,补充资源拆分、首屏关键路径串行化、稳态 CPU 盲区。其中"为节点 body / iframe 加 culling/lazy"与第一轮 culling 议题**互补**(第一轮管"是否渲染 DOM",本轮管"是否加载/构造重依赖与 guest 进程")。

**P0(高影响,本轮新增,与第一轮不重叠)**
- §2.1 默认首启画布的 live external-URL `<webview>` 移出首屏关键路径(占位 + IntersectionObserver/idle 后挂载)。本轮唯一 high,冷启最重单项且外部不可控。
- §2.2 + §2.5 + §2.6 重排 `bootstrap.ts`:先 `openWindow()`/`loadFile`,seeding + 插件激活并发于 renderer 下载/绘制(以 `mainReady` promise 保序;插件工具注册延迟到首个 agent turn 前而非窗口前)。

**P1(高价值资源拆分 + 稳态 CPU)**
- §1.1/§1.2/§1.4/§2.3/§2.4 引入**全仓第一个 `React.lazy` 边界**:`DefaultCanvasNode` 的 8 个 body 全部 lazy + Suspense;`createLowlight(common)` 换 curated 子集;`electron.vite.config.ts` 加 `manualChunks` 拆 xterm/tiptap/lowlight/force-graph。这是首屏 chunk 主线程 parse+eval 的主杠杆(与第一轮 culling 正交:第一轮防 DOM 渲染,本轮防依赖加载/构造)。
- §1.3 chat 子树(markdown-it + hljs)路由级 `React.lazy(ChatView)`。
- §3.2 + §3.3 force-graph:设有界 `cooldownTicks`;`useAllWorkspaceNodeList.onChange` 加工作区过滤 + debounce + 拓扑 diff gate reheat。
- §3.4 + §3.5 mermaid:图间 yield/限并发;idle 预热 import。
- §3.8 renderNode per-(label,fontSize) 宽度缓存 + 标签 zoom 阈值抑制。

**P2(局部/低频/盲区收尾)**
- §1.5 AI/HTML iframe body 改 sidecar 文件 + ref(state-bloat)。
- §1.6 mermaid 源→SVG Map 缓存;§1.7 大图 downscale 移 OffscreenCanvas/worker;§1.8 TreeWalker 全文预检。
- §2.7 module-federation runtime 延迟出 entry chunk;§2.8 i18n 按语言拆分;§2.9 welcome seeding 并发化。
- §3.1 offscreen webview 超越降帧(导航 about:blank / unmount);§3.6 iframe 节点扩展 IntersectionObserver gating;§3.7 移除 highlight particle。
- §3.9 execInSession 输出封顶 + 跨 chunk marker + per-session 串行化;§3.10 scheduleFit 尾沿 debounce + resize 去重 + pty:write 分块。

---

## 实测验证计划

> 本轮依赖未安装,无法 profiling;所有体积/耗时为估算。安装后按下列采集真实数据并替换估算。

**A. Bundle / chunk 体积(验证 §1.x、§2.3/§2.4/§2.7/§2.8)**
```bash
pnpm install
pnpm --filter canvas-workspace build
# 检视 electron-vite 输出 renderer chunk 体积(out/renderer/assets/*.js)
ls -lh apps/canvas-workspace/out/renderer/assets/*.js
```
- 加 `rollup-plugin-visualizer`(或 `source-map-explorer out/renderer/assets/*.js`)出 treemap,确认 lowlight `common`、Tiptap 全家桶、xterm、markdown-it+hljs、`@module-federation/runtime`、`messages.ts` 是否在 entry/startup chunk。
- 指标:startup chunk 总 min/gzip 字节;各重依赖占比;lazy 化后 entry chunk 缩减量、新增 async chunk 数。

**B. 首屏 / time-to-window(验证 §2.1/§2.2/§2.5/§2.6/§2.9)**
- 在 `bootstrap.ts` `app.whenReady()` 起点与 `openWindow()` 处打 `performance.now()` 时间戳,记录 seeding/applyEnv/setupCanvasPlugins/reloadExternal 各段耗时(分有/无外部插件两组)。
- 在 renderer `main.tsx` 首 `createRoot().render()` 前后 + `index.html` boot-screen 可见时刻打点;用 Electron `webContents` `'did-finish-load'`/`'dom-ready'` 事件测 TTFP。
- 指标:app ready → window 可见 ms;boot-screen 可见时刻;重排前后 delta;welcome `<webview>` `did-finish-load` 计入 TTFMP 的耗时;离线下 load-error 闪现时长。

**C. React render / 节点 body 加载(验证 §1.1/§2.3/§3.8)**
- React DevTools Profiler 录制冷启 + 打开各类型节点,统计 DefaultCanvasNode 及各 body 的 render count 与 commit 耗时;lazy 化后确认仅实例化类型的 chunk 被 fetch(Network/Coverage 面板)。
- 指标:首屏各 body 是否被构造;Tiptap `useEditor` 构造次数与耗时;lazy 后 Suspense fallback → resolve 延迟。

**D. webview / PTY 进程与内存(验证 §2.1/§3.1/§3.9/§3.10)**
- `ps`/Electron `app.getAppMetrics()` 采集 guest WebContents 进程数与各自 RSS;offscreen 后台节点用 Chrome Task Manager 观察 CPU% 是否随降帧下降(验证 §3.1:JS/timer 仍跑)。
- 终端拖拽 resize 时计 `pty:resize` IPC 频次(主进程 `ipcMain.on` 计数);execInSession 长跑命令观察 `output` 串增长与监听器数。
- 指标:每 url-mode 节点 guest 进程数/内存;offscreen 节点稳态 CPU%;1s 拖拽 resize 的 IPC + 原生 resize 调用数;execInSession 峰值缓冲字节。

**E. mermaid / force-graph 渲染耗时(验证 §3.2/§3.4/§3.5/§3.7/§3.8)**
- 在 `mermaid.ts` `loadMermaid`(import+initialize)与 `mermaid.render` 前后 `performance.now()`,实测首遇 1MB import 耗时与每图 layout 耗时;含 3 图回复测流末 burst 总时长。
- force-graph:DevTools Performance 录制 hover(particle rAF)、toggle(12s reheat)、跨工作区 onChange,测 per-frame `measureText` 调用数与帧时长、reheat 主线程占用秒数。
- 指标:mermaid 首遇 import+init ms / 每图 render ms;force-graph hover 期帧时长与 measureText/frame;每 toggle reheat 主线程累计 ms;有界 `cooldownTicks` 前后对比。

(以上文件路径均为绝对/仓内真实路径;所有数值均标注为估算,待 B–E 实测替换。)