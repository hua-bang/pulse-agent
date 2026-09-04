import type { MentionItem } from '../../../../types';
import type { I18nKey } from '../../../../i18n';

export const CANVAS_MENTION_PREFIX = 'canvas:';
export const SKILL_MENTION_PREFIX = 'skill:';
/** Installed Agent Plugin preference: `@[plugin:<id>|<name>]`. */
export const PLUGIN_MENTION_PREFIX = 'plugin:';
/** Multi-role chat persona: `@[role:<id>|<name>]` (SSOT: shared/agent-roles). */
export { ROLE_MENTION_PREFIX } from '../../../../../../shared/agent-roles';
export const FOLDER_MENTION_PREFIX = 'folder:';
export const TAG_MENTION_PREFIX = 'tag:';
export const DOM_MENTION_PREFIX = 'dom:';
/** Tab mention; current markers append `|ref=<hex-json>` reopen identity. */
export const TAB_MENTION_PREFIX = 'tab:';
/** Assistant-emitted session citation: `@[session:<wsId>:<sessionId>:<msgIdx?>|<label>]`. */
export const SESSION_MENTION_PREFIX = 'session:';

export const MENTION_GROUPS = [
  { key: 'role', label: 'Roles', labelKey: 'chat.mention.role' },
  { key: 'plugin', label: 'Plugins', labelKey: 'chat.mention.plugins' },
  { key: 'skill', label: 'Skills', labelKey: 'chat.mention.skills' },
  { key: 'tab', label: 'Tabs', labelKey: 'chat.mention.tab' },
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

export function getMentionGroupKey(item: MentionItem): MentionGroupKey {
  if (item.type === 'role') return 'role';
  if (item.type === 'plugin') return 'plugin';
  if (item.type === 'skill') return 'skill';
  if (item.type === 'tab') return 'tab';
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

/** Per-group cap applied by `sortAndCapMentionItems`. */
export const MENTION_GROUP_MAX_ITEMS = 6;

/**
 * Groups items by `MENTION_GROUP_ORDER`, keeps at most
 * `MENTION_GROUP_MAX_ITEMS` per group (order-preserving within each group),
 * then concatenates in group order. No further overall cap is applied: with
 * `MENTION_GROUP_ORDER.length` groups this already bounds the result at
 * `MENTION_GROUP_ORDER.length * MENTION_GROUP_MAX_ITEMS` items, small enough
 * for the popup's own scroll to handle.
 *
 * This replaced a plain `sort` by group followed by a flat
 * `slice(0, MENTION_MAX_ITEMS)`, which looked safe but silently dropped
 * entire late-sorting groups whenever earlier groups alone already exceeded
 * the cap. `canvas` (one entry per workspace) sorts after every node-type
 * group, so on a canvas with many mindmap/text/agent nodes those alone could
 * fill the whole cap and the popup ended up with no Canvas entries at all —
 * capping per group first is what guarantees every non-empty group gets a
 * chance to show something.
 */
export function sortAndCapMentionItems(items: MentionItem[]): MentionItem[] {
  const byGroup = new Map<MentionGroupKey, MentionItem[]>();
  for (const item of items) {
    const key = getMentionGroupKey(item);
    const bucket = byGroup.get(key);
    if (bucket) bucket.push(item);
    else byGroup.set(key, [item]);
  }
  const capped: MentionItem[] = [];
  for (const key of MENTION_GROUP_ORDER) {
    const bucket = byGroup.get(key);
    if (bucket) capped.push(...bucket.slice(0, MENTION_GROUP_MAX_ITEMS));
  }
  return capped;
}
