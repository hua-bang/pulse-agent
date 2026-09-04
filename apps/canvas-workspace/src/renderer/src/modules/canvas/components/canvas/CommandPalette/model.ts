import type { CanvasNode, FileNodeData, TextNodeData } from '../../../../../types';

export interface PaletteCommand {
  id: string;
  title: string;
  hint?: string;
  group: 'create' | 'navigate' | 'view' | 'edit' | 'help';
  aliases?: string[];
  shortcut?: string;
  enabled?: boolean;
  run: () => void;
}

export interface NodePaletteItem {
  kind: 'node';
  node: CanvasNode;
  matchType: 'title-prefix' | 'title-contains' | 'filename' | 'content' | 'recent';
  matchText: string;
}

export interface CommandPaletteItem {
  kind: 'command';
  command: PaletteCommand;
}

export type PaletteItem = NodePaletteItem | CommandPaletteItem;
export type PaletteSectionId = PaletteCommand['group'] | 'nodes' | 'commands' | 'recent';
export interface PaletteSection {
  id: PaletteSectionId;
  items: PaletteItem[];
}

const GROUP_ORDER: Array<PaletteCommand['group']> = ['edit', 'create', 'navigate', 'view', 'help'];
const MAX_NODE_RESULTS = 20;

const contentMatch = (node: CanvasNode, query: string): NodePaletteItem | null => {
  if (node.type !== 'file' && node.type !== 'text') return null;
  const content = node.type === 'file'
    ? (node.data as FileNodeData).content || ''
    : (node.data as TextNodeData).content || '';
  const index = content.toLowerCase().indexOf(query);
  if (index < 0) return null;
  const start = Math.max(0, index - 20);
  const end = Math.min(content.length, index + query.length + 20);
  return {
    kind: 'node',
    node,
    matchType: 'content',
    matchText: `${start > 0 ? '...' : ''}${content.slice(start, end)}${end < content.length ? '...' : ''}`,
  };
};

const matchNode = (node: CanvasNode, query: string): NodePaletteItem | null => {
  const title = node.title.toLowerCase();
  if (title.startsWith(query)) return { kind: 'node', node, matchType: 'title-prefix', matchText: node.title };
  if (title.includes(query)) return { kind: 'node', node, matchType: 'title-contains', matchText: node.title };
  if (node.type === 'file') {
    const path = (node.data as FileNodeData).filePath || '';
    const name = path.split('/').pop() || '';
    if (name.toLowerCase().includes(query) || path.toLowerCase().includes(query)) {
      return { kind: 'node', node, matchType: 'filename', matchText: path };
    }
  }
  return contentMatch(node, query);
};

export const buildPaletteSections = (
  nodes: CanvasNode[],
  commands: PaletteCommand[],
  query: string,
): PaletteSection[] => {
  const enabledCommands = commands.filter((command) => command.enabled !== false);
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    const sections: PaletteSection[] = GROUP_ORDER.flatMap((group) => {
      const items = enabledCommands
        .filter((command) => command.group === group)
        .map((command): CommandPaletteItem => ({ kind: 'command', command }));
      return items.length > 0 ? [{ id: group, items }] : [];
    });
    const recent = [...nodes]
      .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
      .slice(0, 8)
      .map((node): NodePaletteItem => ({
        kind: 'node',
        node,
        matchType: 'recent',
        matchText: node.title,
      }));
    if (recent.length > 0) sections.push({ id: 'recent', items: recent });
    return sections;
  }

  const priority: Record<NodePaletteItem['matchType'], number> = {
    'title-prefix': 0,
    'title-contains': 1,
    filename: 2,
    content: 3,
    recent: 4,
  };
  const nodeItems = nodes
    .map((node) => matchNode(node, normalized))
    .filter((item): item is NodePaletteItem => !!item)
    .sort((left, right) => priority[left.matchType] - priority[right.matchType]
      || left.node.title.localeCompare(right.node.title))
    .slice(0, MAX_NODE_RESULTS);
  const commandItems = enabledCommands
    .filter((command) => command.title.toLowerCase().includes(normalized)
      || command.aliases?.some((alias) => alias.toLowerCase().includes(normalized)))
    .map((command): CommandPaletteItem => ({ kind: 'command', command }));
  return [
    ...(nodeItems.length > 0 ? [{ id: 'nodes' as const, items: nodeItems }] : []),
    ...(commandItems.length > 0 ? [{ id: 'commands' as const, items: commandItems }] : []),
  ];
};
