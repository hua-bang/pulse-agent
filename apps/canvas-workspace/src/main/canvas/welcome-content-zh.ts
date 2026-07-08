import type { WelcomeContent } from './welcome-content-types';

const DOWNLOAD_URL = 'https://pulse-canvas-download.pages.dev/';

/** Shared look for the HTML cards: same font stack, kbd chips, soft panels. */
const BASE_CSS = `
html,body{margin:0;height:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;-webkit-font-smoothing:antialiased}
*{box-sizing:border-box}
kbd{background:#f6f8fa;border:1px solid #d0d7de;border-bottom-width:3px;border-radius:6px;padding:2px 7px;font-size:12px;font-family:ui-monospace,SFMono-Regular,monospace;white-space:nowrap}
.wrap{padding:22px 26px;background:#fff;height:100%;overflow:auto}
.wrap h2{margin:0 0 14px;font-size:18px;color:#1f2328}
.muted{font-size:12.5px;color:#57606a}
`;

const HERO_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
.hero{position:relative;height:100%;overflow:hidden;display:flex;flex-direction:column;justify-content:center;padding:0 48px;background:linear-gradient(135deg,#4f6ef7 0%,#7c4ff7 55%,#b44ff7 100%);color:#fff}
.blob{position:absolute;border-radius:50%;background:rgba(255,255,255,.13);animation:float 9s ease-in-out infinite}
.b1{width:200px;height:200px;right:-50px;top:-70px}
.b2{width:130px;height:130px;right:140px;bottom:-56px;animation-delay:3s}
.b3{width:70px;height:70px;left:-24px;bottom:30px;animation-delay:5s}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(16px)}}
h1{margin:0 0 10px;font-size:44px;letter-spacing:.5px}
.tag{margin:0;font-size:18px;opacity:.95}
.chips{display:flex;gap:10px;margin-top:20px}
.chip{padding:6px 15px;border:1px solid rgba(255,255,255,.5);border-radius:999px;font-size:13px}
</style></head><body><div class="hero"><div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div>
<h1>Pulse Canvas</h1><p class="tag">和 AI 一起思考的画布</p>
<div class="chips"><span class="chip">🏠 本地优先</span><span class="chip">🧩 万物皆节点</span><span class="chip">🤖 AI 原生</span></div>
</div></body></html>`;

const FEATURE_GRID_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:22px;height:100%;background:#fafbfc;overflow:auto}
.tile{background:#fff;border:1px solid #e6e8ec;border-radius:14px;padding:16px 18px;transition:transform .15s,box-shadow .15s}
.tile:hover{transform:translateY(-3px);box-shadow:0 8px 20px rgba(31,35,40,.10)}
.emoji{font-size:26px}
.tile h3{margin:8px 0 4px;font-size:15px;color:#1f2328}
.tile p{margin:0;font-size:12.5px;color:#57606a;line-height:1.55}
</style></head><body><div class="grid">
<div class="tile"><div class="emoji">📝</div><h3>笔记即文件</h3><p>Note 的内容保存为本地 Markdown，数据永远是你的。</p></div>
<div class="tile"><div class="emoji">🌐</div><h3>网页入画</h3><p>URL 或 HTML 都能成为节点——这张卡片本身就是。</p></div>
<div class="tile"><div class="emoji">🧠</div><h3>思维导图</h3><p>一个节点装下一棵树，AI 还能帮你继续扩展。</p></div>
<div class="tile"><div class="emoji">💬</div><h3>AI Chat</h3><p>整张画布就是它的上下文，选中什么就聊什么。</p></div>
<div class="tile"><div class="emoji">🖥</div><h3>终端与 Agent</h3><p>命令行和 Claude Code / Codex 直接放上画布。</p></div>
<div class="tile"><div class="emoji">🗂</div><h3>空间即组织</h3><p>Frame、连线、标签——位置本身就是信息。</p></div>
</div></body></html>`;

const CONCEPT_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
.wrap{background:#fafbfc}
.cap{display:flex;gap:12px;margin-top:14px}
.cap div{flex:1;background:#fff;border:1px solid #e6e8ec;border-radius:10px;padding:10px 12px;font-size:12.5px;color:#57606a;text-align:center}
.cap b{display:block;color:#1f2328;font-size:13.5px;margin-bottom:3px}
</style></head><body><div class="wrap">
<h2>画布三要素</h2>
<svg viewBox="0 0 640 210" width="100%" xmlns="http://www.w3.org/2000/svg">
<rect x="10" y="12" width="620" height="186" rx="16" fill="#f1f3f6" stroke="#a5b4cf" stroke-width="2" stroke-dasharray="7 5"/>
<text x="34" y="42" font-size="13" fill="#7a8699">区域 Frame</text>
<rect x="70" y="76" width="160" height="76" rx="12" fill="#eef2ff" stroke="#5b7cbf" stroke-width="2"/>
<text x="150" y="120" font-size="15" text-anchor="middle" fill="#1f2328">💡 一个想法</text>
<rect x="410" y="76" width="160" height="76" rx="12" fill="#fff" stroke="#5b7cbf" stroke-width="2"/>
<text x="490" y="120" font-size="15" text-anchor="middle" fill="#1f2328">📋 一份方案</text>
<defs><marker id="ah" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0 0 L10 4 L0 8 z" fill="#7c4ff7"/></marker></defs>
<path d="M230 114 C 300 114 340 114 405 114" stroke="#7c4ff7" stroke-width="2.5" fill="none" marker-end="url(#ah)"/>
<text x="318" y="102" font-size="12.5" text-anchor="middle" fill="#7c4ff7">连线 Edge</text>
</svg>
<div class="cap">
<div><b>节点</b>承载内容</div>
<div><b>连线</b>表达关系</div>
<div><b>Frame</b>收纳区域</div>
</div>
</div></body></html>`;

const BASICS_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
table{width:100%;border-collapse:collapse;font-size:14px}
td{padding:9px 12px;border-bottom:1px solid #eaeef2;color:#1f2328}
td:first-child{width:46%;color:#57606a}
</style></head><body><div class="wrap">
<h2>🧭 画布操作速查</h2>
<table>
<tr><td>移动节点</td><td>按住节点拖动</td></tr>
<tr><td>调整大小</td><td>拖动节点边角</td></tr>
<tr><td>重命名</td><td>双击节点标题</td></tr>
<tr><td>复制节点</td><td><kbd>Cmd/Ctrl</kbd> + <kbd>D</kbd></td></tr>
<tr><td>微调位置</td><td>方向键（<kbd>Shift</kbd> 大步移动）</td></tr>
<tr><td>平移画布</td><td>按住空白处拖动 / 滚轮</td></tr>
<tr><td>缩放画布</td><td><kbd>Cmd/Ctrl</kbd> + 滚轮 / 触控板捏合</td></tr>
<tr><td>聚焦选中节点</td><td><kbd>F</kbd></td></tr>
<tr><td>退出聚焦 / 清空选择</td><td><kbd>Esc</kbd></td></tr>
</table>
</div></body></html>`;

const KANBAN_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
.wrap{background:#fafbfc;display:flex;flex-direction:column}
.cols{display:flex;gap:12px;flex:1;min-height:0}
.col{flex:1;background:#f1f3f6;border-radius:12px;padding:10px}
.col h4{margin:2px 4px 10px;font-size:13px;color:#57606a}
.card{background:#fff;border:1px solid #e6e8ec;border-radius:10px;padding:9px 11px;font-size:12.5px;color:#1f2328;margin-bottom:8px;box-shadow:0 1px 2px rgba(31,35,40,.05)}
.hint{margin:12px 2px 0}
</style></head><body><div class="wrap">
<h2>用三个 Frame 做轻量看板</h2>
<div class="cols">
<div class="col"><h4>📚 资料区</h4><div class="card">🌐 竞品收藏</div><div class="card">📝 灵感碎片</div></div>
<div class="col"><h4>🚧 进行中</h4><div class="card">📋 需求草稿</div><div class="card">🧠 项目脑图</div></div>
<div class="col"><h4>✅ 已完成</h4><div class="card">🎯 目标对齐</div></div>
</div>
<p class="muted hint">节点在 Frame 之间拖动，就是状态流转。Frame 支持重命名、折叠，选多个节点 <kbd>Cmd/Ctrl</kbd>+<kbd>G</kbd> 可先编组。</p>
</div></body></html>`;

const CHAT_MOCK_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
.chat{display:flex;flex-direction:column;gap:12px;padding:20px 22px;background:#fafbfc;height:100%;overflow:auto;font-size:13.5px}
.bubble{max-width:84%;padding:11px 15px;border-radius:16px;line-height:1.6}
.user{align-self:flex-end;background:#4f6ef7;color:#fff;border-bottom-right-radius:5px}
.ai{align-self:flex-start;background:#fff;border:1px solid #e6e8ec;border-bottom-left-radius:5px;color:#1f2328}
.hint{align-self:center;margin-top:4px;text-align:center}
</style></head><body><div class="chat">
<div class="bubble user">总结这张画布，给我一个下一步计划</div>
<div class="bubble ai">这张画布有 5 个区域：产品介绍、画布三要素、组织信息、AI 协作和进阶玩法。<br>建议下一步：<br>① 双击 02 区的便签，感受节点编辑<br>② 选中 04 区的两张素材卡，让我合并成结论<br>③ 把「Pulse Canvas 全景」脑图再扩展一层</div>
<div class="bubble user">你怎么知道我选中了什么？</div>
<div class="bubble ai">选中节点后，你的问题会带上它们作为上下文——这就是「选中即上下文」🎯</div>
<p class="muted hint">↑ 这是 AI Chat 的样子 —— 按 <kbd>Cmd/Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> 和真的聊聊</p>
</div></body></html>`;

const WORKFLOW_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
.wrap{background:#fafbfc;display:flex;flex-direction:column}
.flow{display:flex;align-items:stretch;gap:6px;margin-top:6px}
.step{flex:1;background:#fff;border:1px solid #e6e8ec;border-radius:12px;padding:14px 8px;text-align:center;font-size:12.5px;color:#1f2328;line-height:1.5}
.step .e{font-size:22px;display:block;margin-bottom:6px}
.arr{align-self:center;color:#7c4ff7;font-size:16px}
.loop{margin-top:14px;text-align:center;font-size:12.5px;color:#7c4ff7}
ul{margin:14px 0 0;padding-left:18px;font-size:13px;color:#57606a;line-height:1.8}
</style></head><body><div class="wrap">
<h2>一个完整的工作循环</h2>
<div class="flow">
<div class="step"><span class="e">📝</span>记录目标</div><div class="arr">→</div>
<div class="step"><span class="e">🌐</span>收集资料</div><div class="arr">→</div>
<div class="step"><span class="e">💬</span>AI 总结</div><div class="arr">→</div>
<div class="step"><span class="e">🖥</span>落地执行</div><div class="arr">→</div>
<div class="step"><span class="e">📌</span>沉淀复盘</div>
</div>
<div class="loop">↺ 结论回到 Note，进入下一轮</div>
<ul>
<li>信息在左、动作在右，AI 在中间穿针引线</li>
<li>执行阶段可以在画布上打开终端或本机已安装的 CLI 工具</li>
</ul>
</div></body></html>`;

const SHORTCUTS_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
table{width:100%;border-collapse:collapse;font-size:14px}
td{padding:9px 12px;border-bottom:1px solid #eaeef2;color:#1f2328}
td:first-child{width:46%;color:#57606a}
</style></head><body><div class="wrap">
<h2>⌨️ 全局快捷键</h2>
<table>
<tr><td>命令面板</td><td><kbd>Cmd/Ctrl</kbd> + <kbd>K</kbd> 或 <kbd>Cmd/Ctrl</kbd> + <kbd>H</kbd></td></tr>
<tr><td>搜索画布与笔记</td><td><kbd>Cmd/Ctrl</kbd> + <kbd>F</kbd></td></tr>
<tr><td>打开 AI Chat</td><td><kbd>Cmd/Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>A</kbd></td></tr>
<tr><td>编组 / 取消编组</td><td><kbd>Cmd/Ctrl</kbd> + <kbd>G</kbd> / + <kbd>Shift</kbd> + <kbd>G</kbd></td></tr>
<tr><td>复制节点</td><td><kbd>Cmd/Ctrl</kbd> + <kbd>D</kbd></td></tr>
<tr><td>聚焦 / 退出</td><td><kbd>F</kbd> / <kbd>Esc</kbd></td></tr>
</table>
</div></body></html>`;

export const WELCOME_CONTENT_ZH: WelcomeContent = {
  frames: {
    welcome: '01 · 初识 Pulse Canvas',
    basics: '02 · 画布三要素',
    organize: '03 · 组织信息',
    ai: '04 · 与 AI 协作',
    advanced: '05 · 进阶玩法',
  },
  notes: {
    welcome: {
      title: '欢迎使用 Pulse Canvas',
      filename: 'welcome-to-pulse-canvas.md',
      content: `# 欢迎使用 Pulse Canvas

Pulse Canvas 是一个本地优先的可视化工作区：笔记、网页、思维导图、终端和 AI Agent 都住在同一张画布上。

**这张画布就是产品说明书**——五个区域由浅入深：

1. 初识 Pulse Canvas（你在这里）
2. 画布三要素：节点、连线、Frame
3. 把信息组织起来
4. 与 AI 协作
5. 进阶玩法

所有节点都可以随便拖、随便改，玩坏了也没关系——这张画布只属于你。往右走 →
`,
    },
    practice: {
      title: '拖拖我试试',
      filename: 'try-dragging-me.md',
      content: `# 拖动我

- 按住标题栏拖动，换个位置
- 拖右下角，改改大小
- 双击标题，给我改个名字
- \`Cmd/Ctrl+D\` 复制一个我

我是一个 **Note 节点**：内容保存为本地 Markdown 文件，适合写需求、方案、会议记录和阶段总结。
`,
    },
    answer: {
      title: 'Pulse Canvas 的答案',
      filename: 'one-canvas.md',
      content: `# 放进同一张画布

浏览器 20 个标签页、3 个笔记软件、无数终端窗口……信息散落各处，上下文不断丢失。

Pulse Canvas 的答案：**网页、笔记、终端都变成节点**，放进同一张画布，用连线表达关系——就像左边这条线。

👈 连线画法：选中节点，从边缘锚点拖出，落在目标节点上。
`,
    },
    reference: {
      title: '让资料随叫随到',
      filename: 'pin-and-reference.md',
      content: `# 让资料随叫随到

- 节点右上角的 📌 可以把它固定到 **Reference 面板**——切到别的画布也能随时召回
- 同一个角落还能「加入聊天上下文」，AI 回答时会带上它
- 左侧 **Nodes** 视图列出所有节点；**Graph** 视图查看节点关系网络和标签覆盖
`,
    },
    prompts: {
      title: '让 AI 先干三件事',
      filename: 'first-prompts.md',
      content: `# 让 AI 先干三件事

打开右侧 AI Chat（\`Cmd/Ctrl+Shift+A\`），把下面的话复制进去试试：

1. \`总结这张画布的内容，给我一个 3 步的下一步计划\`
2. \`帮我把「Pulse Canvas 全景」思维导图再扩展一层\`
3. 选中右边两张素材卡后问：\`把这两个节点的信息合并成一段产品介绍\`

> 还没配置模型？打开 **Settings → Models**，添加 OpenAI-compatible 或 Anthropic-compatible provider，填好 API Key 即可。
`,
    },
    context: {
      title: '选中即上下文',
      filename: 'select-then-ask.md',
      content: `# 选中即上下文

先选中节点再提问，输入框会变成 “Ask about these nodes...”——AI 只围绕你选中的内容工作。

**试一试**：按住 Shift 点选右边的「设计理念」和「用户评价」两个节点，让 AI 把它们合并成一段产品介绍。
`,
    },
    ideas: {
      title: 'Pulse Canvas 的三个设计理念',
      filename: 'design-principles.md',
      content: `# 三个设计理念

1. **本地优先** —— 数据是你磁盘上的 Markdown 文件，不锁在任何云端
2. **空间即组织** —— 位置、连线、区域本身就是信息，不用先想「放进哪个文件夹」
3. **AI 原生** —— 画布就是 AI 的上下文，选中什么就聊什么，而不是把 AI 关在侧边栏里
`,
    },
    project: {
      title: '把工作区连到项目',
      filename: 'connect-your-project.md',
      content: `# 把工作区连到项目

1. 侧边栏 → **Workspace Settings** → 设置 Root folder
2. 之后终端和 Coding Agent 默认在该目录里工作（需要本机已安装对应 CLI）
3. 用 \`pulse-workspace.md\` 记录目标、状态和约定——AI Chat 每一轮都会读取这份上下文
`,
    },
  },
  texts: {
    guide: {
      title: '开始',
      content: '**从这里开始，往右走 →**\n\n5 个区域 · 由浅入深',
    },
    practice: {
      title: '便签',
      content: '👋 双击我，改几个字试试',
    },
    problem: {
      title: '问题',
      content: '😵 信息散落在 20 个标签页、3 个笔记软件和无数终端窗口里',
    },
    edgeTeach: {
      title: '连线',
      content: '👆 这条线是**连线（Edge）**：选中节点，从边缘锚点拖出',
    },
    frameIntro: {
      title: '什么是 Frame',
      content:
        '你看到的这些彩色大框就是 **Frame**——把相关节点收进同一个区域。\n\n这一区示范 Pulse Canvas 的组织方式：脑图理结构、看板管推进、引用防丢失。',
    },
    aiOpen: {
      title: '打开 AI Chat',
      content: '`Cmd/Ctrl+Shift+A` 打开右侧 AI Chat（或点左下角 Pulse 图标）',
    },
    feedback: {
      title: '用户评价',
      content: '🗣 用户评价：「终于不用在窗口之间来回切了」「AI 能看到我选中的东西，太顺了」',
    },
    multiWorkspace: {
      title: '多工作区',
      content:
        '左侧 **+** 号可以创建多个工作区；跨工作区复制节点会尽量保留引用关系。\n\n这张欢迎画布只在第一次启动时出现——放心改造它，让它变成你的工作台。',
    },
  },
  shape: {
    title: 'Shape',
    text: '我是 Shape 节点，工具栏里还有圆形、菱形、星星',
  },
  download: { title: 'Pulse Canvas 下载页', url: DOWNLOAD_URL },
  cards: {
    hero: { title: 'Pulse Canvas', html: HERO_HTML },
    featureGrid: { title: '它能做什么', html: FEATURE_GRID_HTML },
    concept: { title: '画布三要素', html: CONCEPT_HTML },
    basics: { title: '画布操作速查', html: BASICS_HTML },
    kanban: { title: '用 Frame 做看板', html: KANBAN_HTML },
    chatMock: { title: 'AI Chat 长什么样', html: CHAT_MOCK_HTML },
    workflow: { title: '一个完整的工作循环', html: WORKFLOW_HTML },
    shortcuts: { title: '全局快捷键', html: SHORTCUTS_HTML },
  },
  mindmap: {
    title: 'Pulse Canvas 全景',
    root: {
      text: 'Pulse Canvas',
      children: [
        {
          text: '🧩 节点',
          children: [{ text: '笔记 / 文本' }, { text: '网页 / HTML' }, { text: '思维导图' }, { text: '终端 & Agent' }],
        },
        {
          text: '🗂 组织',
          children: [{ text: 'Frame 与看板' }, { text: '标签与 Graph' }, { text: 'Reference 面板' }],
        },
        {
          text: '🤖 AI',
          children: [{ text: '总结画布' }, { text: '选中即上下文' }, { text: '生成思维导图' }],
        },
        {
          text: '💾 数据',
          children: [{ text: '本地 Markdown' }, { text: '多工作区' }],
        },
      ],
    },
  },
  edges: {
    problemToAnswer: 'Pulse Canvas 的答案',
    contextToIdeas: '试试选中这两个',
  },
};
