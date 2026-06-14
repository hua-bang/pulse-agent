import { promises as fs } from 'fs';
import { join } from 'path';
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

const WELCOME_NOTE_CONTENT = `# 欢迎使用 Pulse Canvas

Pulse Canvas 是一个本地优先的可视化工作区：你可以把笔记、网页、文件、终端和 AI Agent 放在同一张画布上，一边整理信息，一边推进动作。

## 你可以先试试

- 拖动节点，调整它们的位置和大小。
- 打开右侧 AI Chat，让它总结当前画布或分析节点关系。
- 用底部工具栏添加 Note、Web、Mindmap、Coding Agent 等节点。
- 双击网页节点顶部地址栏，可以像浏览器一样修改 URL。

右侧的网页节点打开的是 Pulse Canvas 下载页：${DOWNLOAD_URL}
`;

const WELCOME_DETAIL_CONTENT = `# Pulse Canvas 使用详细

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
`;

export interface WelcomeWorkspaceSeedResult {
  seeded: boolean;
  workspaceId?: string;
}

const makeWelcomeNodes = (
  now: number,
  welcomeNotePath: string,
  detailNotePath: string,
): CanvasNode[] => [
    {
      id: WELCOME_NOTE_NODE_ID,
      type: 'file',
      title: '欢迎使用 Pulse Canvas',
      x: 56,
      y: 80,
      width: 503,
      height: 453,
      data: {
        filePath: welcomeNotePath,
        content: WELCOME_NOTE_CONTENT,
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
      title: 'Pulse Canvas 使用详细',
      x: 56,
      y: 584.5,
      width: 502,
      height: 853,
      data: {
        filePath: detailNotePath,
        content: WELCOME_DETAIL_CONTENT,
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
): Promise<WelcomeWorkspaceSeedResult> {
  const existing = await listWorkspaces(root);
  if (existing.workspaces.length > 0) return { seeded: false };

  const now = Date.now();
  const seededAt = new Date(now).toISOString();
  const workspaceDir = getWorkspaceDir(WELCOME_WORKSPACE_ID, root);
  const notesDir = join(workspaceDir, 'notes');
  const welcomeNotePath = join(notesDir, WELCOME_NOTE_FILENAME);
  const detailNotePath = join(notesDir, WELCOME_DETAIL_FILENAME);

  await fs.mkdir(notesDir, { recursive: true });
  await fs.writeFile(welcomeNotePath, WELCOME_NOTE_CONTENT, 'utf-8');
  await fs.writeFile(detailNotePath, WELCOME_DETAIL_CONTENT, 'utf-8');

  await saveCanvas(
    WELCOME_WORKSPACE_ID,
    {
      nodes: makeWelcomeNodes(now, welcomeNotePath, detailNotePath),
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
