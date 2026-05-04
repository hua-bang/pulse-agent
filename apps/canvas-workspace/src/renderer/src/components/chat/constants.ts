import type { MentionItem, QuickAction } from './types';

export const CANVAS_MENTION_PREFIX = 'canvas:';

export const MENTION_GROUPS = [
  { key: 'file', label: 'File' },
  { key: 'text', label: 'Text' },
  { key: 'mindmap', label: 'Mindmap' },
  { key: 'link', label: 'Link' },
  { key: 'agent', label: 'Agent' },
  { key: 'terminal', label: 'Terminal' },
  { key: 'frame', label: 'Frame' },
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
