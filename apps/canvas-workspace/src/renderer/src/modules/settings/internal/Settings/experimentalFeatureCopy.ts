import type { LanguageCode } from '../../../../i18n';
import {
  EXPERIMENTAL_FLAG_AGENT_CODEMODE,
  EXPERIMENTAL_FLAG_AGENT_DEBUG_TRACE,
  EXPERIMENTAL_FLAG_AGENT_RUNTIME_CONTROL,
  EXPERIMENTAL_FLAG_AGENT_TEAMS,
  EXPERIMENTAL_FLAG_CHANNELS,
  EXPERIMENTAL_FLAG_DEFAULT_BROWSER,
  EXPERIMENTAL_FLAG_DYNAMIC_APP,
  EXPERIMENTAL_FLAG_PI_AGENT_HARNESS,
  EXPERIMENTAL_FLAG_WEBVIEW_PAGE_CONTROL,
  EXPERIMENTAL_FLAG_WORKSPACE_GRAPH,
  EXPERIMENTAL_FLAG_WORKSPACE_NODES,
} from '../../../../../../shared/experimental-features';

interface FeatureCopy {
  label: string;
  description: string;
}

/**
 * Translated Settings copy for each registered feature. It lives here, not in
 * the app catalogs, because only the lazy Settings page reads it and the
 * English catalog ships in the startup bundle. The registry keeps the full
 * English text for main and for features without an entry here.
 */
export const FEATURE_COPY: Record<string, Record<LanguageCode, FeatureCopy>> = {
  [EXPERIMENTAL_FLAG_AGENT_CODEMODE]: {
    en: {
      label: 'Agent Codemode',
      description:
        'Adds a codemode tool. The agent runs a sandboxed script that calls read-only canvas tools and enabled MCP tools, and gets only the script output. Applies to new agent sessions.',
    },
    zh: {
      label: '代码模式（Agent）',
      description:
        '新增 codemode 工具：Agent 在沙箱中运行脚本，脚本可调用只读画布工具和已启用的 MCP 工具，只返回脚本输出。对新建的 Agent 会话生效。',
    },
  },
  [EXPERIMENTAL_FLAG_PI_AGENT_HARNESS]: {
    en: {
      label: 'Pi AgentHarness runtime',
      description:
        'Run the default assistant with Pi, keeping Canvas tools, model settings, and chat history. Off by default; Engine remains the default runtime.',
    },
    zh: {
      label: 'Pi AgentHarness 运行时',
      description:
        '使用 Pi 运行默认助手，保留画布工具、模型设置和对话历史。默认关闭，使用 Engine。',
    },
  },
  [EXPERIMENTAL_FLAG_AGENT_RUNTIME_CONTROL]: {
    en: {
      label: 'Agent runtime control',
      description:
        'Lets authenticated local developer tools find and call an allowlisted set of live app capabilities.',
    },
    zh: {
      label: 'Agent 运行时控制',
      description:
        '允许经过认证的本地开发者工具发现并调用白名单内的应用实时能力。',
    },
  },
  [EXPERIMENTAL_FLAG_AGENT_DEBUG_TRACE]: {
    en: {
      label: 'Agent DevTools',
      description:
        'Adds a DevTools page that shows debug traces for each agent run: chat history, tool calls, and raw model payloads.',
    },
    zh: {
      label: 'Agent DevTools',
      description:
        '新增 DevTools 页面，查看每次 Agent 运行的调试记录：对话历史、工具调用和原始模型请求。',
    },
  },
  [EXPERIMENTAL_FLAG_WORKSPACE_NODES]: {
    en: {
      label: 'Workspace Nodes page',
      description:
        'Adds a Nodes page that shows every node in the workspace as a filterable grid, with a detail page for each node.',
    },
    zh: {
      label: '工作区节点页',
      description:
        '新增“节点”页面，以可筛选的网格显示工作区内的所有节点，并为每个节点提供详情页。',
    },
  },
  [EXPERIMENTAL_FLAG_WORKSPACE_GRAPH]: {
    en: {
      label: 'Workspace Graph page',
      description:
        'Adds a Graph page that shows all workspace nodes as a force-directed graph, with search suggestions.',
    },
    zh: {
      label: '工作区图谱页',
      description:
        '新增“图谱”页面，以力导向图显示工作区内的所有节点，并提供搜索建议。',
    },
  },
  [EXPERIMENTAL_FLAG_WEBVIEW_PAGE_CONTROL]: {
    en: {
      label: 'Webview page control (agent)',
      description:
        'Lets the agent click, type, scroll, and run scripts in web pages inside iframe nodes. Local, browser-internal, and sensitive sites (banks, payments, logins) are blocked. The agent can use any site you are signed in to.',
    },
    zh: {
      label: '网页控制（Agent）',
      description:
        '允许 Agent 在 iframe 节点的网页中点击、输入、滚动和运行脚本。本地页面、浏览器内部页面和敏感网站（银行、支付、登录）会被拦截。Agent 可以使用你已登录的任何网站。',
    },
  },
  [EXPERIMENTAL_FLAG_DYNAMIC_APP]: {
    en: {
      label: 'Dynamic apps (agent)',
      description:
        'Lets the agent create live iframe apps backed by a local server: apps that poll an external source, or small stateful apps such as to-do lists and forms. Scripts run in a sandbox. Off by default because it adds agent tools and a background server.',
    },
    zh: {
      label: '动态应用（Agent）',
      description:
        '允许 Agent 创建由本地服务驱动的实时 iframe 应用：定时拉取外部数据的应用，或待办、表单等带状态的小应用。脚本在沙箱中运行。默认关闭，因为它会新增 Agent 工具并运行后台服务。',
    },
  },
  [EXPERIMENTAL_FLAG_CHANNELS]: {
    en: {
      label: 'Feishu Bot',
      description:
        'Chat with your canvas AI and run tasks from Feishu. Requires bot credentials; messages are sent through Feishu.',
    },
    zh: {
      label: '飞书机器人',
      description:
        '在飞书中与画布 AI 对话并执行任务。启用后需配置机器人凭据，消息将通过飞书传输。',
    },
  },
  [EXPERIMENTAL_FLAG_AGENT_TEAMS]: {
    en: {
      label: 'Agent Teams',
      description:
        'Shows the Agent Team entry on the canvas for multi-agent planning and execution. Saved Agent Team frames still open when this is off.',
    },
    zh: {
      label: 'Agent 团队',
      description:
        '在画布上显示 Agent 团队入口，用于多 Agent 规划与执行。关闭后，已保存的 Agent 团队框架仍可打开。',
    },
  },
  [EXPERIMENTAL_FLAG_DEFAULT_BROWSER]: {
    en: {
      label: 'Set as default browser (not recommended)',
      description:
        'Opens http and https links from any app in a Pulse Canvas browser tab. Not recommended: many sites do not load in the app, and there are no bookmarks, extensions, or password autofill. Restart the app after you change it. Works only in a packaged build.',
    },
    zh: {
      label: '设为默认浏览器（不推荐）',
      description:
        '让任意应用中的 http/https 链接在 Pulse Canvas 的浏览器标签中打开。不推荐：很多网站无法在应用内加载，也没有书签、扩展和密码自动填充。修改后请重启应用。仅在打包版本中生效。',
    },
  },
};
