import type { MentionItem, QuickAction } from './types';

export const CANVAS_MENTION_PREFIX = 'canvas:';

/**
 * Sentinel workspace id used when the chat is in "unbound" mode (no workspace
 * picked). The UI surface keeps a nullable workspaceId, but every layer below
 * ChatPageBody — hooks, IPC, the canvas-agent — keeps treating workspaceId
 * as a string. The unbound state is stored under a regular workspace bucket
 * at `~/.pulse-coder/canvas/__global__/` so session storage and history just
 * work without further special-casing.
 */
export const GLOBAL_WORKSPACE_ID = '__global__';

export const MENTION_GROUPS = [
  { key: 'file', label: 'File' },
  { key: 'text', label: 'Text' },
  { key: 'mindmap', label: 'Mindmap' },
  { key: 'link', label: 'Link' },
  { key: 'agent', label: 'Agent' },
  { key: 'terminal', label: 'Terminal' },
  { key: 'frame', label: 'Frame' },
  { key: 'group', label: 'Group' },
  { key: 'canvas', label: 'Canvas' },
  { key: 'proj-file', label: 'Project Files' },
] as const;

export type MentionGroupKey = (typeof MENTION_GROUPS)[number]['key'];

export const MENTION_GROUP_ORDER: MentionGroupKey[] = MENTION_GROUPS.map(group => group.key);

export const MENTION_GROUP_LABEL: Record<MentionGroupKey, string> = Object.fromEntries(
  MENTION_GROUPS.map(group => [group.key, group.label]),
) as Record<MentionGroupKey, string>;

export const MENTION_MAX_ITEMS = 30;

export const QUICK_ACTIONS: QuickAction[] = [
  {
    key: 'summarize_canvas',
    label: '总结当前画布',
    prompt: '总结当前画布。',
  },
  {
    key: 'analyze_relations',
    label: '分析节点关系',
    prompt: '分析当前画布中节点之间的关系。',
  },
  {
    key: 'create_mindmap',
    label: '生成思维导图',
    prompt: '基于当前画布生成一个思维导图。',
  },
  {
    key: 'organize_selection',
    label: '整理选中内容',
    prompt: '整理当前选中的节点内容。',
    requiresSelection: true,
  },
];

export const UNBOUND_QUICK_ACTIONS: QuickAction[] = [
  {
    key: 'brainstorm_topic',
    label: '帮我头脑风暴一个话题',
    prompt: '我想头脑风暴一个新话题，请引导我从不同角度展开思考。',
  },
  {
    key: 'explain_concept',
    label: '解释一个概念',
    prompt: '请用通俗易懂的方式解释一个我不熟悉的概念。',
  },
  {
    key: 'draft_text',
    label: '帮我起草一段文字',
    prompt: '帮我起草一段文字，先告诉我你需要哪些信息。',
  },
];

export function getMentionGroupKey(item: MentionItem): MentionGroupKey {
  if (item.type === 'workspace') return 'canvas';
  if (item.type === 'file') return 'proj-file';

  switch (item.nodeType) {
    case 'agent':
      return 'agent';
    case 'terminal':
      return 'terminal';
    case 'frame':
      return 'frame';
    case 'group':
      return 'group';
    case 'text':
      return 'text';
    case 'mindmap':
      return 'mindmap';
    case 'iframe':
      return 'link';
    case 'file':
    default:
      return 'file';
  }
}
