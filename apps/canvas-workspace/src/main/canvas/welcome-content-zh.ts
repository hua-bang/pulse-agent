import type { WelcomeContent } from './welcome-content-types';

const DOWNLOAD_URL = 'https://pulse-canvas-download.pages.dev/';
const REFERENCE_PAGE_URL = 'https://developer.mozilla.org/zh-CN/docs/Web/Performance/Lazy_loading';

const CARD_BASE_CSS = `
html,body{margin:0;height:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif}
kbd{background:#f6f8fa;border:1px solid #d0d7de;border-bottom-width:3px;border-radius:6px;padding:2px 7px;font-size:12px;font-family:ui-monospace,SFMono-Regular,monospace;white-space:nowrap}
table{width:100%;border-collapse:collapse;font-size:14px}
td{padding:9px 12px;border-bottom:1px solid #eaeef2;color:#1f2328}
td:first-child{width:46%;color:#57606a}
h2{margin:0 0 12px;font-size:18px;color:#1f2328}
.wrap{padding:22px 26px;box-sizing:border-box;background:#fff;height:100%;overflow:auto}
`;

const SLOGAN_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif}
.card{height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 42px;box-sizing:border-box;background:linear-gradient(135deg,#4f6ef7 0%,#7c4ff7 55%,#b44ff7 100%);color:#fff}
h1{margin:0 0 10px;font-size:36px;letter-spacing:.5px}
p{margin:0;font-size:17px;opacity:.94}
.sub{margin-top:8px;font-size:13px;opacity:.75}
</style></head><body><div class="card"><h1>Pulse Canvas</h1><p>和 AI 一起思考的画布</p><p class="sub">笔记 · 网页 · 思维导图 · 终端 · Agent —— 都在同一张画布上</p></div></body></html>`;

const BASICS_CARD_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>${CARD_BASE_CSS}</style></head><body><div class="wrap">
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
<p style="margin:14px 0 0;font-size:13px;color:#57606a">这张卡片本身是一个 HTML 网页节点 —— 网页也可以住在画布上。</p>
</div></body></html>`;

const SHORTCUTS_CARD_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>${CARD_BASE_CSS}</style></head><body><div class="wrap">
<h2>⌨️ 全局快捷键</h2>
<table>
<tr><td>命令面板</td><td><kbd>Cmd/Ctrl</kbd> + <kbd>K</kbd> 或 <kbd>Cmd/Ctrl</kbd> + <kbd>H</kbd></td></tr>
<tr><td>搜索画布与笔记</td><td><kbd>Cmd/Ctrl</kbd> + <kbd>F</kbd></td></tr>
<tr><td>打开 AI Chat</td><td><kbd>Cmd/Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>A</kbd></td></tr>
<tr><td>编组 / 取消编组</td><td><kbd>Cmd/Ctrl</kbd> + <kbd>G</kbd> / <kbd>Cmd/Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>G</kbd></td></tr>
<tr><td>复制节点</td><td><kbd>Cmd/Ctrl</kbd> + <kbd>D</kbd></td></tr>
<tr><td>聚焦 / 退出</td><td><kbd>F</kbd> / <kbd>Esc</kbd></td></tr>
</table>
</div></body></html>`;

export const WELCOME_CONTENT_ZH: WelcomeContent = {
  frames: {
    welcome: '01 · 欢迎',
    basics: '02 · 画布基础',
    organize: '03 · 组织信息',
    ai: '04 · 与 AI 协作',
    advanced: '05 · 进阶工作流',
  },
  notes: {
    welcome: {
      title: '欢迎使用 Pulse Canvas',
      filename: 'welcome-to-pulse-canvas.md',
      content: `# 欢迎使用 Pulse Canvas

Pulse Canvas 是一个本地优先的可视化工作区：笔记、网页、思维导图、终端和 AI Agent 都住在同一张画布上。

这张画布本身就是教程。我们请了一位向导——前端工程师**小舟**，她正在用 Pulse Canvas 规划「官网改版」项目。从左到右逛完 5 个区域，看看她怎么把想法、资料和 AI 放在一起工作。

所有节点都可以随便拖、随便改，玩坏了也没关系——这张画布只属于你。

准备好了就往右走 →
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
    solution: {
      title: '方案：首屏提速',
      filename: 'homepage-speedup-plan.md',
      content: `# 首屏提速方案

小舟把左边那个 💡 想法展开成了这份方案：

1. 首屏大图改为懒加载
2. 骨架屏占位，减少布局抖动
3. 静态资源上 CDN

👈 左边那条**连线**就是这么画的：选中节点，从边缘的锚点拖出，松手落在目标节点上。想法和方案，从此有了去处。
`,
    },
    kanban: {
      title: '用 Frame 做轻量看板',
      filename: 'kanban-with-frames.md',
      content: `# 用 Frame 做轻量看板

小舟的用法：建三个 Frame——「📚 资料区」「🚧 进行中」「✅ 已完成」，节点在区域之间拖动，就是状态流转。

Frame 还可以：

- 双击标题重命名
- 折叠收起里面的内容
- 选中多个节点按 \`Cmd/Ctrl+G\` 先编成一组再放进来
`,
    },
    reference: {
      title: '让资料随叫随到',
      filename: 'pin-and-reference.md',
      content: `# 让资料随叫随到

- 节点右上角的 📌 可以把它固定到 **Reference 面板**——切到别的画布也能随时召回
- 节点右上角还能「加入聊天上下文」，AI 回答时会带上它
- 左侧 **Nodes** 视图列出所有节点；**Graph** 视图查看节点关系网络和标签覆盖
`,
    },
    prompts: {
      title: '让 AI 先干三件事',
      filename: 'first-prompts.md',
      content: `# 让 AI 先干三件事

打开右侧 AI Chat（\`Cmd/Ctrl+Shift+A\`），把下面的话复制进去试试：

1. \`总结这张画布的内容，给我一个 3 步的下一步计划\`
2. \`帮我把「官网改版」思维导图再扩展一层\`
3. 选中右边两个素材节点后问：\`把这两个节点的信息合并成一段结论\`

> 还没配置模型？打开 **Settings → Models**，添加 OpenAI-compatible 或 Anthropic-compatible provider，填好 API Key 即可。
`,
    },
    context: {
      title: '选中即上下文',
      filename: 'select-then-ask.md',
      content: `# 选中即上下文

先选中节点再提问，输入框会变成 “Ask about these nodes...”——AI 只围绕你选中的内容工作。

**试一试**：按住 Shift 点选右边的「会议记录」和「用户反馈」两个节点，让 AI 把它们合并成一段结论。
`,
    },
    meeting: {
      title: '会议记录 · 官网改版',
      filename: 'meeting-notes-website-revamp.md',
      content: `# 6/30 官网改版启动会

- **目标**：两周内上线新首页
- **结论**：首屏性能优先，视觉其次
- **待定**：移动端适配范围
- **风险**：设计稿 7/3 才能到位
- **Owner**：小舟
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
    loop: {
      title: '小舟的一次完整循环',
      filename: 'a-real-work-loop.md',
      content: `# 小舟的一次完整工作循环

1. 在 Note 里写下目标和待办（像 02 区那样）
2. 把参考网页拖成 Web 节点放在旁边（像 04 区那样）
3. 让 AI Chat 总结画布、生成计划
4. 进入执行阶段——需要时在画布上打开终端或本机已安装的 CLI 工具
5. 把阶段结论沉淀回 Note，进入下一轮

信息在左，动作在右，AI 在中间穿针引线——这就是 Pulse Canvas 的工作方式。
`,
    },
  },
  texts: {
    guide: {
      title: '开始',
      content: '**从这里开始，往右走 →**\n\n5 个区域 · 5 分钟上手',
    },
    practice: {
      title: '便签',
      content: '👋 双击我，改几个字试试',
    },
    idea: {
      title: '想法',
      content: '💡 想法：首屏加载太慢，用户在流失',
    },
    edgeTeach: {
      title: '连线',
      content: '👆 这条线是**连线（Edge）**：选中节点，从边缘锚点拖出',
    },
    frameIntro: {
      title: '什么是 Frame',
      content:
        '你看到的这些彩色大框就是 **Frame**——把相关节点收进同一个区域。\n\n这一区的主角是小舟的「官网改版」项目：先用思维导图理清结构，再用看板推进执行。',
    },
    aiOpen: {
      title: '打开 AI Chat',
      content: '`Cmd/Ctrl+Shift+A` 打开右侧 AI Chat（或点左下角 Pulse 图标）',
    },
    feedback: {
      title: '用户反馈',
      content: '🗣 用户反馈摘录：「第一次打开不知道该点哪里」「首页图片加载好慢」',
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
  iframes: {
    slogan: { title: 'Pulse Canvas', html: SLOGAN_HTML },
    download: { title: 'Pulse Canvas 下载页', url: DOWNLOAD_URL },
    referencePage: { title: '参考资料 · 图片懒加载', url: REFERENCE_PAGE_URL },
    basicsCard: { title: '画布操作速查', html: BASICS_CARD_HTML },
    shortcuts: { title: '全局快捷键', html: SHORTCUTS_CARD_HTML },
  },
  mindmap: {
    title: '小舟的项目脑图',
    root: {
      text: '官网改版',
      children: [
        {
          text: '🎯 目标',
          children: [{ text: '两周上线新首页' }, { text: '首屏加载 < 2s' }],
        },
        {
          text: '📚 资料',
          children: [{ text: '竞品截图' }, { text: '用户反馈' }, { text: '性能报告' }],
        },
        {
          text: '✅ 待办',
          children: [{ text: '信息架构' }, { text: '视觉稿' }, { text: '懒加载改造' }],
        },
      ],
    },
  },
  edges: {
    ideaToSolution: '展开成方案',
    contextToMeeting: '试试选中这两个',
  },
};
