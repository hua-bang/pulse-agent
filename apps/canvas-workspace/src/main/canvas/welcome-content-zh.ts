import type { WelcomeContent } from './welcome-content-types';
import {
  chatMockCard,
  conceptCard,
  featureGrid,
  heroCard,
  kanbanCard,
  settingsMockCard,
  stepListCard,
  tableCard,
  workflowCard,
} from './welcome-cards';

const DOWNLOAD_URL = 'https://pulse-canvas-download.pages.dev/';

const HERO_HTML = heroCard({
  nameA: 'Pulse',
  nameB: 'Canvas',
  tagline: '和 AI 一起思考的画布',
  chips: ['本地优先', '万物皆节点', 'AI 原生'],
  frameLabel: 'FRAME',
  nodeA: '📝 笔记',
  nodeB: '🌐 网页',
});

const FIRST_MINUTE_HTML = stepListCard(
  'FIRST MINUTE',
  '第一分钟，先学会三件事',
  [
    { icon: 'pan', n: 'STEP 01', title: '移动画布', desc: '按住空白处拖动——往右走就能看到第 2 区' },
    { icon: 'zoom', n: 'STEP 02', title: '缩放', desc: 'Cmd/Ctrl + 滚轮缩放；选中节点按 F 聚焦' },
    { icon: 'edit', n: 'STEP 03', title: '编辑', desc: '双击左下角的黄便签，改几个字试试' },
  ],
  '✓ 三件都做完了？往右走 →',
);

const FEATURE_GRID_HTML = featureGrid('WHAT IT CAN DO', '它能做什么', [
  { icon: 'note', title: '笔记即文件', desc: '内容是本地 Markdown' },
  { icon: 'globe', title: '网页入画', desc: 'URL 和 HTML 都是节点' },
  { icon: 'mindmap', title: '思维导图', desc: '一个节点装下一棵树' },
  { icon: 'chat', title: 'AI Chat', desc: '画布就是它的上下文' },
  { icon: 'terminal', title: '终端与 Agent', desc: '命令行直接上画布' },
  { icon: 'frame', title: '空间即组织', desc: '位置本身就是信息' },
]);

const CONCEPT_HTML = conceptCard({
  eyebrow: 'CANVAS ESSENTIALS',
  heading: '画布三要素',
  frameLabel: 'FRAME · 区域',
  nodeA: '一个想法',
  nodeB: '一份方案',
  edgeLabel: 'EDGE · 连线',
  caps: [
    { term: '节点', desc: '承载内容' },
    { term: '连线', desc: '表达关系' },
    { term: 'Frame', desc: '收纳区域' },
  ],
});

const BASICS_HTML = tableCard(
  'BASICS',
  '画布操作速查',
  [
    { label: '移动节点', value: '按住节点拖动' },
    { label: '调整大小', value: '拖动节点边角' },
    { label: '重命名', value: '双击节点标题' },
    { label: '复制节点', value: '<kbd>Cmd/Ctrl</kbd> + <kbd>D</kbd>' },
    { label: '微调位置', value: '方向键（<kbd>Shift</kbd> 大步移动）' },
    { label: '平移画布', value: '按住空白处拖动 / 滚轮' },
    { label: '缩放画布', value: '<kbd>Cmd/Ctrl</kbd> + 滚轮 / 触控板捏合' },
    { label: '聚焦选中节点', value: '<kbd>F</kbd>' },
    { label: '退出聚焦 / 清空选择', value: '<kbd>Esc</kbd>' },
  ],
  '这张卡片本身是一个 HTML 网页节点——网页也可以住在画布上。',
);

const KANBAN_HTML = kanbanCard(
  'ORGANIZE',
  '用三个 Frame 做轻量看板',
  [
    { dot: '#8B93A3', label: '资料区', items: ['竞品收藏', '灵感碎片'] },
    { dot: '#3A63F2', label: '进行中', items: ['需求草稿', '项目脑图'] },
    { dot: '#2F9E63', label: '已完成', items: ['目标对齐'] },
  ],
  '节点在 Frame 之间拖动，就是状态流转。Frame 支持重命名、折叠；选多个节点 <kbd>Cmd/Ctrl</kbd>+<kbd>G</kbd> 可先编组。',
);

const SETUP_HTML = settingsMockCard({
  eyebrow: 'STEP 0 · SETUP',
  heading: '先把模型配上',
  nav: [{ label: 'General' }, { label: 'Models', on: true }, { label: 'Agent' }, { label: 'About' }],
  fields: [
    { label: 'Provider', value: 'Anthropic-compatible ▾' },
    { label: 'Base URL', value: 'https://api.example.com/v1' },
    { label: 'API Key', value: '••••••••••••' },
  ],
  button: '保存并测试',
  steps: ['打开 Settings', '选 Models', '添加 provider 填 Key', '回来问 AI'],
  hint: '上面是 Settings → Models 的样子——配好模型，右边的三句话才发得出去。',
});

const CHAT_MOCK_HTML = chatMockCard(
  'AI CHAT',
  [
    { who: 'user', html: '总结这张画布，给我一个下一步计划' },
    {
      who: 'ai',
      html: '这张画布有 5 个区域：产品介绍、画布三要素、组织信息、AI 协作和进阶玩法。建议下一步：<ol><li>双击 02 区的便签，感受节点编辑</li><li>选中 04 区的两张素材卡，让我合并成结论</li><li>把「Pulse Canvas 全景」脑图再扩展一层</li></ol>',
    },
    { who: 'user', html: '你怎么知道我选中了什么？' },
    { who: 'ai', html: '选中节点后，你的问题会带上它们作为上下文——这就是「选中即上下文」。' },
  ],
  '↑ 这是 AI Chat 的样子——按 <kbd>Cmd/Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> 和真的聊聊',
);

const WORKFLOW_HTML = workflowCard(
  'WORKFLOW',
  '一个完整的工作循环',
  [
    { n: '01', label: '记录目标' },
    { n: '02', label: '收集资料' },
    { n: '03', label: 'AI 总结' },
    { n: '04', label: '落地执行' },
    { n: '05', label: '沉淀复盘' },
  ],
  '↺ 结论回到 Note，进入下一轮',
  ['信息在左、动作在右，AI 在中间穿针引线', '执行阶段可以在画布上打开终端或本机已安装的 CLI 工具'],
);

const SHORTCUTS_HTML = tableCard('SHORTCUTS', '全局快捷键', [
  { label: '命令面板', value: '<kbd>Cmd/Ctrl</kbd> + <kbd>K</kbd> 或 <kbd>Cmd/Ctrl</kbd> + <kbd>H</kbd>' },
  { label: '搜索画布与笔记', value: '<kbd>Cmd/Ctrl</kbd> + <kbd>F</kbd>' },
  { label: '打开 AI Chat', value: '<kbd>Cmd/Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>A</kbd>' },
  { label: '编组 / 取消编组', value: '<kbd>Cmd/Ctrl</kbd> + <kbd>G</kbd> / + <kbd>Shift</kbd> + <kbd>G</kbd>' },
  { label: '复制节点', value: '<kbd>Cmd/Ctrl</kbd> + <kbd>D</kbd>' },
  { label: '聚焦 / 退出', value: '<kbd>F</kbd> / <kbd>Esc</kbd>' },
]);

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

**这张画布就是产品说明书**，五个区域由浅入深：

01 初识 → 02 三要素 → 03 组织 → 04 AI 协作 → 05 进阶

先做右上角「第一分钟」的三件事，再往右逛。玩坏了也没关系——这张画布只属于你。
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

> 还没配置模型？看左边的「第 0 步」卡片。
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
  download: { title: '下载页 · 分享给朋友', url: DOWNLOAD_URL },
  cards: {
    hero: { title: 'Pulse Canvas', html: HERO_HTML },
    firstMinute: { title: '第一分钟', html: FIRST_MINUTE_HTML },
    featureGrid: { title: '它能做什么', html: FEATURE_GRID_HTML },
    concept: { title: '画布三要素', html: CONCEPT_HTML },
    basics: { title: '画布操作速查', html: BASICS_HTML },
    kanban: { title: '用 Frame 做看板', html: KANBAN_HTML },
    setup: { title: '第 0 步 · 配置模型', html: SETUP_HTML },
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
