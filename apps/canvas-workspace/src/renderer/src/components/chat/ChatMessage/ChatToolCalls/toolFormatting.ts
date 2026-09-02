import type { I18nKey } from '../../../../i18n/messages';
import type { ToolCallStatus } from '../../../../types';

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

export function formatToolSignature(name: string, args: any): string {
  if (!args) return `${name}()`;

  const parts: string[] = [];
  if (name === 'read' || name === 'write') {
    if (args.file_path || args.filePath) parts.push(JSON.stringify(args.file_path || args.filePath));
  } else if (name === 'edit') {
    if (args.file_path || args.filePath) parts.push(JSON.stringify(args.file_path || args.filePath));
    if (args.old_string) parts.push(JSON.stringify(truncate(args.old_string, 30)));
  } else if (name === 'bash') {
    if (args.command) parts.push(JSON.stringify(truncate(args.command, 60)));
  } else if (name === 'grep') {
    if (args.pattern) parts.push(JSON.stringify(args.pattern));
    if (args.path) parts.push(JSON.stringify(args.path));
  } else if (name === 'ls') {
    if (args.path) parts.push(JSON.stringify(args.path));
  } else {
    for (const value of Object.values(args)) {
      if (parts.length >= 3) break;
      if (typeof value === 'string') parts.push(JSON.stringify(truncate(value, 40)));
      else if (typeof value === 'number') parts.push(String(value));
    }
  }

  return `${name}(${parts.join(', ')})`;
}

const pickStringArg = (args: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
};

const quoteInline = (value: string, max = 64): string => JSON.stringify(truncate(value, max));

const describeSearchTarget = (args: Record<string, unknown>): string | null => (
  pickStringArg(args, ['path'])
  ?? pickStringArg(args, ['glob'])
  ?? pickStringArg(args, ['type'])
);

export function formatToolDescription(tool: Pick<ToolCallStatus, 'name' | 'args'>): string | null {
  if (!tool.args || typeof tool.args !== 'object') return null;
  const args = tool.args as Record<string, unknown>;
  const explicitDescription = pickStringArg(args, ['description']);
  if (explicitDescription) return explicitDescription;

  const filePath = pickStringArg(args, ['filePath', 'file_path', 'path']);
  switch (tool.name) {
    case 'read':
      return filePath ? `Read ${truncate(filePath, 96)}` : null;
    case 'write':
      return filePath ? `Write ${truncate(filePath, 96)}` : null;
    case 'edit':
      return filePath ? `Edit ${truncate(filePath, 96)}` : null;
    case 'grep': {
      const pattern = pickStringArg(args, ['pattern', 'query']);
      if (!pattern) return null;
      const target = describeSearchTarget(args);
      return target
        ? `Search ${quoteInline(pattern)} in ${truncate(target, 72)}`
        : `Search ${quoteInline(pattern)}`;
    }
    case 'ls': {
      const path = pickStringArg(args, ['path']);
      return path ? `List ${truncate(path, 96)}` : null;
    }
    default:
      return null;
  }
}

export const TOOL_LABEL_SLUGS: Record<string, string> = {
  canvas_read_context: 'readCanvasContext',
  canvas_read_node: 'readNode',
  dock_list_tabs: 'listTabs',
  dock_read_tab: 'readTab',
  dock_activate_tab: 'activateTab',
  dock_open_tab: 'openTab',
  browser_read_dom_selection: 'readDomSelection',
  knowledge_search_nodes: 'searchKnowledgeNodes',
  knowledge_read_node: 'readKnowledgeNode',
  knowledge_analyze_image: 'analyzeKnowledgeImage',
  canvas_create_node: 'createNode',
  canvas_create_agent_node: 'createAgentNode',
  canvas_create_terminal_node: 'createTerminalNode',
  canvas_update_node: 'updateNode',
  canvas_delete_node: 'deleteNode',
  canvas_move_node: 'moveNode',
  canvas_send_to_agent: 'sendToAgent',
  read: 'readFile',
  write: 'writeFile',
  edit: 'editFile',
  grep: 'search',
  ls: 'listDir',
  bash: 'runCommand',
  skill: 'readSkill',
  clarify: 'clarify',
  tavily: 'searchWeb',
  tavily_extract: 'searchWeb',
  tavily_crawl: 'searchWeb',
  tavily_map: 'searchWeb',
  session_search: 'searchSession',
  session_summary: 'summarizeSession',
};

export function displayToolStatus(tool: ToolCallStatus): ToolCallStatus['status'] {
  if (tool.status !== 'succeeded' || !tool.result) return tool.status;
  try {
    const result = JSON.parse(tool.result) as { ok?: unknown } | null;
    return result?.ok === false ? 'failed' : tool.status;
  } catch {
    return tool.status;
  }
}

export function formatToolLabel(name: string, status: ToolCallStatus['status'], t: (key: I18nKey) => string): string {
  if (status === 'failed') {
    return name === 'dock_activate_tab'
      ? t('toolCall.activateTab.failed')
      : t('chat.toolCalls.failed');
  }
  if (status === 'cancelled') return t('chat.toolCalls.cancelled');
  if (status === 'queued') return t('chat.toolCalls.queued');
  const slug = TOOL_LABEL_SLUGS[name];
  const state = status === 'running' ? 'running' : 'done';
  if (slug) {
    return t(`toolCall.${slug}.${state}` as I18nKey);
  }
  return t(`toolCall.default.${state}`);
}
