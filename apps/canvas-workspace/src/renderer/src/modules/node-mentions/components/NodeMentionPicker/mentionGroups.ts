import type { AgentContextTabRef, CanvasNode, FileNodeData } from '../../../../types';

export type MentionEntry =
  | { kind: 'tab'; key: string; tab: AgentContextTabRef }
  | { kind: 'node'; key: string; node: CanvasNode };

export interface MentionGroup {
  /** 'tab' for dock tabs, otherwise the canvas node type. */
  key: 'tab' | CanvasNode['type'];
  entries: MentionEntry[];
}

/** Section order: dock tabs first, then node types from container to leaf.
 *  A Record, so a new node type fails typecheck until it gets a section. */
const NODE_TYPE_RANK: Record<CanvasNode['type'], number> = {
  frame: 0,
  group: 1,
  text: 2,
  mindmap: 3,
  iframe: 4,
  file: 5,
  image: 6,
  agent: 7,
  terminal: 8,
  shape: 9,
  reference: 10,
  'dynamic-app': 11,
  plugin: 12,
};

/** Each section shows at most this many matches, so one large type cannot hide the others. */
export const MENTION_GROUP_MAX_ENTRIES = 8;

interface GroupOptions {
  nodes: CanvasNode[];
  tabs: AgentContextTabRef[];
  query: string;
  /** Localized type label, so a query such as "frame" or "终端" matches a whole type. */
  typeLabel: (entry: MentionEntry) => string;
}

const searchText = (entry: MentionEntry, typeLabel: string): string => {
  if (entry.kind === 'tab') return `${entry.tab.title} ${entry.tab.url ?? ''} ${typeLabel}`;
  const filePath = entry.node.type === 'file' ? (entry.node.data as FileNodeData).filePath ?? '' : '';
  return `${entry.node.title} ${filePath} ${typeLabel}`;
};

/** Filter dock tabs and canvas nodes by the query and group them into typed sections. */
export function groupMentionEntries({ nodes, tabs, query, typeLabel }: GroupOptions): MentionGroup[] {
  const q = query.trim().toLowerCase();
  const matches = (entry: MentionEntry) => !q || searchText(entry, typeLabel(entry)).toLowerCase().includes(q);

  const groups: MentionGroup[] = [];
  const tabEntries = tabs
    .map((tab): MentionEntry => ({ kind: 'tab', key: `tab:${tab.id}`, tab }))
    .filter(matches);
  if (tabEntries.length > 0) groups.push({ key: 'tab', entries: tabEntries.slice(0, MENTION_GROUP_MAX_ENTRIES) });

  const byType = new Map<CanvasNode['type'], MentionEntry[]>();
  for (const node of nodes) {
    const entry: MentionEntry = { kind: 'node', key: `node:${node.id}`, node };
    if (!matches(entry)) continue;
    const bucket = byType.get(node.type);
    if (bucket) bucket.push(entry);
    else byType.set(node.type, [entry]);
  }
  const types = [...byType.keys()].sort((a, b) => NODE_TYPE_RANK[a] - NODE_TYPE_RANK[b]);
  for (const type of types) {
    groups.push({ key: type, entries: (byType.get(type) ?? []).slice(0, MENTION_GROUP_MAX_ENTRIES) });
  }
  return groups;
}
