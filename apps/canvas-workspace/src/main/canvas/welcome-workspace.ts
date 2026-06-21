import { promises as fs } from 'fs';
import { join } from 'path';
import { app } from 'electron';
import { STORE_DIR, atomicWriteJson, getWorkspaceDir } from './storage';
import { saveCanvas } from './service';
import {
  WORKSPACES_MANIFEST_FILENAME,
  listWorkspaces,
} from './workspaces';
import type { CanvasNode } from './storage';

export const WELCOME_WORKSPACE_ID = 'default';
export const WELCOME_WORKSPACE_NAME = 'Pulse Canvas';

const DOWNLOAD_URL = 'https://pulse-canvas-download.pages.dev/';
const WELCOME_NOTE_NODE_ID = 'node-welcome-note';
const WELCOME_DOWNLOAD_NODE_ID = 'node-welcome-download';
const WELCOME_DETAIL_NODE_ID = 'node-welcome-detail';
const WELCOME_NOTE_FILENAME = 'welcome-to-pulse-canvas.md';
const WELCOME_DETAIL_FILENAME = 'pulse-canvas-usage-details.md';

/** Language for the seeded welcome content. Matches the renderer's
 *  i18n language codes. Resolved once at seed time; the welcome note is
 *  persisted to disk and not re-translated if the user switches language
 *  afterwards (acceptable for one-time onboarding content). */
export type WelcomeLanguage = 'zh' | 'en';

interface WelcomeStrings {
  noteTitle: string;
  detailTitle: string;
  noteContent: string;
  detailContent: string;
}

const WELCOME_STRINGS: Record<WelcomeLanguage, WelcomeStrings> = {
  zh: {
    noteTitle: '欢迎使用 Pulse Canvas',
    detailTitle: 'Pulse Canvas 使用详细',
    noteContent: `# 欢迎使用 Pulse Canvas

Pulse Canvas 是一个本地优先的可视化工作区：你可以把笔记、网页、文件、终端和 AI Agent 放在同一张画布上，一边整理信息，一边推进动作。

## 你可以先试试

- 拖动节点，调整它们的位置和大小。
- 打开右侧 AI Chat，让它总结当前画布或分析节点关系。
- 用底部工具栏添加 Note、Web、Mindmap、Coding Agent 等节点。
- 双击网页节点顶部地址栏，可以像浏览器一样修改 URL。

右侧的网页节点打开的是 Pulse Canvas 下载页：${DOWNLOAD_URL}
`,
    detailContent: `# Pulse Canvas 使用详细

这张画布可以当作你的工作台：左边放想法和资料，右边打开网页或文档，底部工具栏随时补充节点，右侧 AI Chat 帮你总结、整理和继续推进。

## 1. 先把工作区连到项目

- 在侧边栏打开工作区设置，可以设置 Root folder。
- 设置后，终端和 Coding Agent 会默认在这个目录里工作。
- 工作区设置里的 \`pulse-workspace.md\` 用来记录目标、状态和约定；AI Chat 每轮都会读取这些上下文。

## 2. 用节点组织信息

- Note：适合写需求、方案、会议记录和阶段总结，内容会保存为本地 Markdown 文件。
- Web：嵌入网页或本地 HTML，可以在节点顶部地址栏直接改 URL，也可以全屏查看。
- Text / Shape：做轻量标注、分隔和视觉提示。
- Frame / Group：把一组节点收拢成区域，适合拆分「资料」「计划」「执行中」。
- Mindmap：把一堆信息整理成树状结构，也可以导出成图片。
- Coding：启动本地 Claude Code 或 Codex 这类 CLI agent。

## 3. 和 AI 一起工作

- 点底部左侧 Pulse 图标或使用 \`Cmd/Ctrl+Shift+A\` 打开右侧 AI Chat。
- 选中节点后提问，输入框会变成「Ask about these nodes...」，适合让 AI 只围绕选中内容工作。
- 常用快捷入口：总结当前画布、分析节点关系、生成思维导图、整理选中内容。
- 如果还没配置模型，去 Settings 里添加 OpenAI-compatible 或 Anthropic-compatible provider。
- Agent 节点需要本机已经安装对应 CLI；Settings > Agent 里可以安装 Pulse Canvas skill，让外部 agent 能读写这张画布。

## 4. 让资料可复用

- 节点标题可以双击重命名，方便之后搜索和引用。
- 节点右上角可以添加到聊天上下文、固定到 Reference 面板、聚焦或全屏。
- 左侧 Nodes 视图可以查看所有节点；Graph 视图可以看节点之间的关系和标签覆盖情况。
- 跨工作区复制节点时，会尽量保留引用关系，避免把上下文丢散。

## 5. 常用操作

- \`Cmd/Ctrl+K\` 或 \`Cmd/Ctrl+H\` 打开命令面板。
- \`Cmd/Ctrl+F\` 搜索当前画布和笔记内容。
- \`F\` 聚焦选中节点，\`Esc\` 退出聚焦、全屏或清空选择。
- \`Cmd/Ctrl+D\` 复制节点，\`Cmd/Ctrl+G\` 编组，\`Cmd/Ctrl+Shift+G\` 取消编组。
- 方向键微调节点位置，按住 Shift 可以一次移动更远。

建议的工作流：先在 Note 写目标和待办，再把关键网页拖进 Web 节点，接着让 AI Chat 总结画布并生成下一步计划。等任务进入执行阶段，再打开终端或 Coding Agent。
`,
  },
  en: {
    noteTitle: 'Welcome to Pulse Canvas',
    detailTitle: 'Pulse Canvas — Detailed Usage',
    noteContent: `# Welcome to Pulse Canvas

Pulse Canvas is a local-first visual workspace: you can place notes, web pages, files, terminals, and AI agents on the same canvas — organizing information on one side while moving work forward on the other.

## Try these first

- Drag nodes to adjust their position and size.
- Open the AI Chat on the right and ask it to summarize the current canvas or analyze node relationships.
- Use the bottom toolbar to add Note, Web, Mindmap, Coding Agent, and other nodes.
- Double-click the address bar at the top of a web node to change its URL, just like a browser.

The web node on the right opens the Pulse Canvas download page: ${DOWNLOAD_URL}
`,
    detailContent: `# Pulse Canvas — Detailed Usage

Treat this canvas as your workbench: notes and references on the left, web pages or docs on the right, the bottom toolbar to drop in more nodes, and the AI Chat on the right to summarize, organize, and keep things moving.

## 1. Connect the workspace to your project

- Open Workspace Settings in the sidebar to set a Root folder.
- Once set, terminals and Coding Agents will work in that directory by default.
- The \`pulse-workspace.md\` file in workspace settings records goals, status, and conventions; AI Chat reads this context every turn.

## 2. Organize information with nodes

- Note: great for requirements, plans, meeting notes, and phase summaries; content is saved as a local Markdown file.
- Web: embeds a web page or local HTML; edit the URL in the node's top address bar, or go fullscreen.
- Text / Shape: lightweight annotations, dividers, and visual cues.
- Frame / Group: collapse a set of nodes into a region — handy for splitting "References", "Plans", "In progress".
- Mindmap: organize a pile of information into a tree; can also be exported as an image.
- Coding: launch a local CLI agent such as Claude Code or Codex.

## 3. Work with AI

- Click the Pulse icon at the bottom-left or press \`Cmd/Ctrl+Shift+A\` to open the AI Chat on the right.
- Select nodes before asking — the input becomes "Ask about these nodes..." so the AI focuses only on what you selected.
- Common shortcuts: summarize the current canvas, analyze node relationships, generate a mindmap, or organize the selection.
- If you haven't configured a model yet, add an OpenAI-compatible or Anthropic-compatible provider in Settings.
- Agent nodes require the corresponding CLI installed locally; in Settings > Agent you can install the Pulse Canvas skill so external agents can read and write this canvas.

## 4. Make your material reusable

- Double-click a node title to rename it, making it easier to search and reference later.
- The top-right corner of a node lets you add it to chat context, pin it to the Reference panel, focus, or go fullscreen.
- The Nodes view on the left lists every node; the Graph view shows relationships and tag coverage.
- When copying nodes across workspaces, references are preserved as much as possible so context stays connected.

## 5. Common operations

- \`Cmd/Ctrl+K\` or \`Cmd/Ctrl+H\` opens the command palette.
- \`Cmd/Ctrl+F\` searches the current canvas and note contents.
- \`F\` focuses the selected node; \`Esc\` exits focus, fullscreen, or clears the selection.
- \`Cmd/Ctrl+D\` duplicates a node, \`Cmd/Ctrl+G\` groups, \`Cmd/Ctrl+Shift+G\` ungroups.
- Arrow keys nudge a node's position; hold Shift to move farther in one step.

Suggested workflow: write goals and to-dos in a Note first, drag key web pages into Web nodes, then let AI Chat summarize the canvas and draft the next-step plan. Once work moves into execution, open a terminal or Coding Agent.
`,
  },
};

/**
 * Resolve the welcome content language. An explicit override wins; otherwise
 * we follow the OS locale via Electron's `app.getLocale()` — which matches the
 * renderer's first-run default (it derives the initial language from
 * `navigator.language`). English is the fallback when the locale can't be
 * read (e.g. unit tests without a live Electron app).
 */
const resolveWelcomeLanguage = (explicit?: WelcomeLanguage): WelcomeLanguage => {
  if (explicit === 'zh' || explicit === 'en') return explicit;
  try {
    const locale = (app?.getLocale?.() ?? '').toLowerCase();
    if (locale.startsWith('zh')) return 'zh';
  } catch {
    // app unavailable (e.g. vitest) — fall through to default
  }
  return 'en';
};

export interface WelcomeWorkspaceSeedResult {
  seeded: boolean;
  workspaceId?: string;
}

const makeWelcomeNodes = (
  now: number,
  welcomeNotePath: string,
  detailNotePath: string,
  strings: WelcomeStrings,
): CanvasNode[] => [
    {
      id: WELCOME_NOTE_NODE_ID,
      type: 'file',
      title: strings.noteTitle,
      x: 56,
      y: 80,
      width: 503,
      height: 453,
      data: {
        filePath: welcomeNotePath,
        content: strings.noteContent,
        saved: true,
        modified: false,
      },
      updatedAt: now,
    },
    {
      id: WELCOME_DOWNLOAD_NODE_ID,
      type: 'iframe',
      title: 'Pulse Canvas Download',
      x: 648,
      y: 80,
      width: 1191,
      height: 1369,
      data: {
        url: DOWNLOAD_URL,
        html: '',
        mode: 'url',
        prompt: '',
      },
      updatedAt: now,
    },
    {
      id: WELCOME_DETAIL_NODE_ID,
      type: 'file',
      title: strings.detailTitle,
      x: 56,
      y: 584.5,
      width: 502,
      height: 853,
      data: {
        filePath: detailNotePath,
        content: strings.detailContent,
        saved: true,
        modified: false,
      },
      updatedAt: now,
    },
  ];

const writeWelcomeManifest = async (root: string, seededAt: string): Promise<void> => {
  await atomicWriteJson(
    join(root, WORKSPACES_MANIFEST_FILENAME),
    JSON.stringify(
      {
        workspaces: [{ id: WELCOME_WORKSPACE_ID, name: WELCOME_WORKSPACE_NAME }],
        folders: [],
        activeId: WELCOME_WORKSPACE_ID,
        welcomeSeededAt: seededAt,
      },
      null,
      2,
    ),
  );
};

export async function ensureWelcomeWorkspaceSeeded(
  root: string = STORE_DIR,
  language?: WelcomeLanguage,
): Promise<WelcomeWorkspaceSeedResult> {
  const existing = await listWorkspaces(root);
  if (existing.workspaces.length > 0) return { seeded: false };

  const strings = WELCOME_STRINGS[resolveWelcomeLanguage(language)];
  const now = Date.now();
  const seededAt = new Date(now).toISOString();
  const workspaceDir = getWorkspaceDir(WELCOME_WORKSPACE_ID, root);
  const notesDir = join(workspaceDir, 'notes');
  const welcomeNotePath = join(notesDir, WELCOME_NOTE_FILENAME);
  const detailNotePath = join(notesDir, WELCOME_DETAIL_FILENAME);

  await fs.mkdir(notesDir, { recursive: true });
  await fs.writeFile(welcomeNotePath, strings.noteContent, 'utf-8');
  await fs.writeFile(detailNotePath, strings.detailContent, 'utf-8');

  await saveCanvas(
    WELCOME_WORKSPACE_ID,
    {
      nodes: makeWelcomeNodes(now, welcomeNotePath, detailNotePath, strings),
      edges: [],
      transform: {
        x: 86.65451428822593,
        y: 15.931529823069752,
        scale: 0.5567047770115934,
      },
      savedAt: seededAt,
    },
    { root },
  );

  await writeWelcomeManifest(root, seededAt);

  return { seeded: true, workspaceId: WELCOME_WORKSPACE_ID };
}
