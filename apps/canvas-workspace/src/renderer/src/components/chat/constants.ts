import type { MentionItem, QuickAction } from './types';
import type { I18nKey } from '../../i18n';

export const CANVAS_MENTION_PREFIX = 'canvas:';
export const SKILL_MENTION_PREFIX = 'skill:';
export const FOLDER_MENTION_PREFIX = 'folder:';
export const TAG_MENTION_PREFIX = 'tag:';
export const DOM_MENTION_PREFIX = 'dom:';
/** Assistant-emitted session citation: `@[session:<wsId>:<sessionId>:<msgIdx?>|<label>]`. */
export const SESSION_MENTION_PREFIX = 'session:';

export const MENTION_GROUPS = [
  { key: 'skill', label: 'Skills', labelKey: 'chat.mention.skills' },
  { key: 'session', label: 'Sessions', labelKey: 'chat.mention.session' },
  { key: 'tag', label: 'Tags', labelKey: 'chat.mention.tag' },
  { key: 'file', label: 'File', labelKey: 'chat.mention.file' },
  { key: 'text', label: 'Text', labelKey: 'chat.mention.text' },
  { key: 'mindmap', label: 'Mindmap', labelKey: 'chat.mention.mindmap' },
  { key: 'link', label: 'Link', labelKey: 'chat.mention.link' },
  { key: 'agent', label: 'Agent', labelKey: 'chat.mention.agent' },
  { key: 'terminal', label: 'Terminal', labelKey: 'chat.mention.terminal' },
  { key: 'frame', label: 'Frame', labelKey: 'chat.mention.frame' },
  { key: 'group', label: 'Group', labelKey: 'chat.mention.group' },
  { key: 'canvas', label: 'Canvas', labelKey: 'chat.mention.canvas' },
  { key: 'proj-folder', label: 'Project Folders', labelKey: 'chat.mention.projectFolders' },
  { key: 'proj-file', label: 'Project Files', labelKey: 'chat.mention.projectFiles' },
] as const;

export type MentionGroupKey = (typeof MENTION_GROUPS)[number]['key'];

export const MENTION_GROUP_ORDER: MentionGroupKey[] = MENTION_GROUPS.map(group => group.key);

export const MENTION_GROUP_LABEL: Record<MentionGroupKey, string> = Object.fromEntries(
  MENTION_GROUPS.map(group => [group.key, group.label]),
) as Record<MentionGroupKey, string>;

export const MENTION_GROUP_LABEL_KEY: Record<MentionGroupKey, I18nKey> = Object.fromEntries(
  MENTION_GROUPS.map(group => [group.key, group.labelKey]),
) as Record<MentionGroupKey, I18nKey>;

export const MENTION_MAX_ITEMS = 30;

export const QUICK_ACTIONS: QuickAction[] = [
  {
    key: 'summarize_canvas',
    label: 'Summarize canvas',
    labelKey: 'chat.quick.summarizeCanvas',
    prompt: 'Summarize the current canvas.',
    promptKey: 'chat.quick.summarizeCanvasPrompt',
  },
  {
    key: 'analyze_relations',
    label: 'Analyze node relations',
    labelKey: 'chat.quick.analyzeRelations',
    prompt: 'Analyze the relationships between nodes on the current canvas.',
    promptKey: 'chat.quick.analyzeRelationsPrompt',
  },
  {
    key: 'create_mindmap',
    label: 'Create mindmap',
    labelKey: 'chat.quick.createMindmap',
    prompt: 'Create a mindmap based on the current canvas.',
    promptKey: 'chat.quick.createMindmapPrompt',
  },
  {
    key: 'organize_selection',
    label: 'Organize selection',
    labelKey: 'chat.quick.organizeSelection',
    prompt: 'Organize the currently selected nodes.',
    promptKey: 'chat.quick.organizeSelectionPrompt',
    requiresSelection: true,
  },
];

export function getMentionGroupKey(item: MentionItem): MentionGroupKey {
  if (item.type === 'skill') return 'skill';
  if (item.type === 'session') return 'session';
  if (item.type === 'tag') return 'tag';
  if (item.type === 'workspace') return 'canvas';
  if (item.type === 'folder') return 'proj-folder';
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
