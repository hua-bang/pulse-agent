import type { CanvasNode, MentionItem, WorkspaceOption } from '../../../types';

const CACHE_TTL_MS = 5_000;
let cached: { key: string; expiresAt: number; items: MentionItem[] } | null = null;
let pending: { key: string; promise: Promise<MentionItem[]> } | null = null;

async function readCanvasNodeMentionItems(
  api: Window['canvasWorkspace']['workspaceNodes'],
  workspaces: WorkspaceOption[],
): Promise<MentionItem[]> {
  const results = await Promise.all(workspaces.map(async (workspace) => {
    try {
      const result = await api.list(workspace.id);
      return { workspace, nodes: result.ok ? result.nodes ?? [] : [] };
    } catch {
      // One unreadable canvas must not hide the others.
      return { workspace, nodes: [] };
    }
  }));
  const nodes = results.flatMap(({ workspace, nodes }) => nodes.map(node => ({ workspace, node })));
  // Recent first: each popup group shows only its first few entries.
  nodes.sort((a, b) => (b.node.updatedAt ?? 0) - (a.node.updatedAt ?? 0));
  return nodes.map(({ workspace, node }) => ({
    type: 'node' as const,
    nodeId: node.id,
    label: node.displayTitle?.trim() || node.title?.trim() || node.id,
    nodeType: node.type as CanvasNode['type'],
    workspaceId: workspace.id,
    description: workspace.name,
  }));
}

/**
 * Nodes of every canvas except `currentWorkspaceId`, whose nodes a
 * canvas-bound chat already gets live from props. Read only when `@` opens,
 * never on mount, so no route lists every workspace up front.
 */
export function loadCanvasNodeMentionItems(
  workspaces: WorkspaceOption[],
  currentWorkspaceId?: string,
): Promise<MentionItem[]> {
  const api = window.canvasWorkspace?.workspaceNodes;
  const others = workspaces.filter(workspace => workspace.id !== currentWorkspaceId);
  if (!api || others.length === 0) return Promise.resolve([]);
  const key = others.map(workspace => `${workspace.id}:${workspace.name}`).join('\n');
  if (cached?.key === key && cached.expiresAt > Date.now()) return Promise.resolve(cached.items);
  if (pending?.key !== key) {
    const promise = readCanvasNodeMentionItems(api, others).then((items) => {
      cached = { key, expiresAt: Date.now() + CACHE_TTL_MS, items };
      return items;
    }).finally(() => {
      if (pending?.promise === promise) pending = null;
    });
    pending = { key, promise };
  }
  // Stale-while-revalidate, like the plugin list: an expired cache answers
  // now and the refresh lands for the next keystroke.
  return cached?.key === key ? Promise.resolve(cached.items) : pending.promise;
}

export function resetCanvasNodeMentionItemsForTests(): void {
  cached = null;
  pending = null;
}
