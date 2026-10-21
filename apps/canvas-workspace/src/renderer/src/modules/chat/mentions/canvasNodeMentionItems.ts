import type { MentionItem, WorkspaceOption } from '../../../types';
import { isKnowledgeNodeType } from '../../../shared/knowledgeNodes';

const CACHE_TTL_MS = 5_000;
let cached: { key: string; expiresAt: number; items: MentionItem[] } | null = null;
let pending: { key: string; promise: Promise<MentionItem[]> } | null = null;

async function readCanvasNodeMentionItems(workspaces: WorkspaceOption[]): Promise<MentionItem[]> {
  const api = window.canvasWorkspace?.workspaceNodes;
  if (!api) return [];
  const results = await Promise.all(workspaces.map(async (workspace) => {
    try {
      const result = await api.list(workspace.id);
      return { workspace, nodes: result.ok ? result.nodes ?? [] : [] };
    } catch {
      // One unreadable canvas must not hide the others.
      return { workspace, nodes: [] };
    }
  }));
  const items: MentionItem[] = [];
  for (const { workspace, nodes } of results) {
    for (const node of nodes) {
      if (!isKnowledgeNodeType(node.type)) continue;
      items.push({
        type: 'node',
        nodeId: node.id,
        label: node.displayTitle?.trim() || node.title?.trim() || node.id,
        nodeType: node.type,
        workspaceId: workspace.id,
        description: workspace.name,
      });
    }
  }
  return items;
}

/**
 * Knowledge nodes of every canvas except `currentWorkspaceId`, for a chat
 * bound to that canvas. Its own nodes come live from props; the global chat
 * gets all canvases' nodes from the app shell instead. Read only when `@`
 * opens, never on mount, so a canvas route does not list every workspace.
 */
export function loadCanvasNodeMentionItems(
  workspaces: WorkspaceOption[],
  currentWorkspaceId: string,
): Promise<MentionItem[]> {
  const others = workspaces.filter(workspace => workspace.id !== currentWorkspaceId);
  if (others.length === 0) return Promise.resolve([]);
  const key = others.map(workspace => `${workspace.id}:${workspace.name}`).join('\n');
  if (cached?.key === key && cached.expiresAt > Date.now()) return Promise.resolve(cached.items);
  if (pending?.key !== key) {
    const promise = readCanvasNodeMentionItems(others).then((items) => {
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
