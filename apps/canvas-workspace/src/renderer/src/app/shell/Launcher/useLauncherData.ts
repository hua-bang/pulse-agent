import { useEffect, useMemo, useState } from 'react';
import type { WorkspaceEntry } from '../../../shared/workspaces';
import type { AgentSessionInfo } from '../../../../../shared/agent-chat';
import type { CanvasSummary } from '../../../../../shared/canvas';
import { readRecentWorkspaceIds } from '../recentWorkspaces';

const THUMB_NODE_LIMIT = 6;
const RECENT_CHAT_LIMIT = 6;
const RECENT_WORKSPACE_LIMIT = 5;
/** Width over height of the thumbnail frame (see `.launcher__thumb-frame`). */
const THUMB_ASPECT = 3.5;

/** A node's box as fractions of the thumbnail frame. */
export interface ThumbRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface WorkspaceSummary {
  nodeCount: number;
  rects: ThumbRect[];
}

export interface RecentChat {
  storeId: string;
  scopeName: string;
  session: AgentSessionInfo;
}

export type NodeBox = { type: string; x: number; y: number; width: number; height: number };

/** Fits the first few cards into a unit frame for the workspace thumbnail. */
export const toThumbRects = (nodes: NodeBox[]): ThumbRect[] => {
  const cards = nodes.filter((node) => node.type !== 'frame' && node.width > 0 && node.height > 0)
    .slice(0, THUMB_NODE_LIMIT);
  if (cards.length === 0) return [];
  const minX = Math.min(...cards.map((node) => node.x));
  const minY = Math.min(...cards.map((node) => node.y));
  const maxX = Math.max(...cards.map((node) => node.x + node.width));
  const maxY = Math.max(...cards.map((node) => node.y + node.height));
  const span = Math.max(maxX - minX, (maxY - minY) * THUMB_ASPECT, 1);
  return cards.map((node) => ({
    left: (node.x - minX) / span,
    top: ((node.y - minY) / span) * THUMB_ASPECT,
    width: node.width / span,
    height: (node.height / span) * THUMB_ASPECT,
  }));
};

/** Most recently opened first; never-opened workspaces keep the sidebar order. */
const pickRecentWorkspaces = (workspaces: WorkspaceEntry[]) => {
  const recentIds = readRecentWorkspaceIds();
  const rank = (id: string) => {
    const index = recentIds.indexOf(id);
    return index < 0 ? recentIds.length : index;
  };
  return [...workspaces]
    .sort((a, b) => rank(a.id) - rank(b.id))
    .slice(0, RECENT_WORKSPACE_LIMIT);
};

/**
 * What the launcher shows: the recent workspaces with layout previews, and
 * the most recent chats across all scopes. A workspace this window already
 * holds is previewed from memory. Any other recent workspace is previewed
 * from `store.summaries`, which only reads the stored layout. It never uses
 * `store.load`, which returns full node payloads and starts file watchers.
 */
export const useLauncherData = (
  workspaces: WorkspaceEntry[],
  loadedNodes: Record<string, NodeBox[]>,
  globalName: string,
) => {
  const [recentChats, setRecentChats] = useState<RecentChat[] | null>(null);
  const [stored, setStored] = useState<Record<string, CanvasSummary | null>>({});
  const workspaceKey = workspaces.map((workspace) => workspace.id).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const recentWorkspaces = useMemo(() => pickRecentWorkspaces(workspaces), [workspaceKey]);

  useEffect(() => {
    const store = window.canvasWorkspace?.store;
    const missing = recentWorkspaces
      .map((workspace) => workspace.id)
      .filter((id) => !loadedNodes[id]);
    if (!store?.summaries || missing.length === 0) return;
    let cancelled = false;
    void store.summaries(missing).then((result) => {
      if (cancelled || !result.ok || !result.summaries) return;
      setStored((current) => ({ ...current, ...result.summaries }));
    });
    return () => {
      cancelled = true;
    };
    // Loaded workspaces win over stored ones, so a later load needs no refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentWorkspaces]);

  const summaries = useMemo(() => {
    const result: Record<string, WorkspaceSummary> = {};
    for (const [id, summary] of Object.entries(stored)) {
      if (summary) result[id] = { nodeCount: summary.nodeCount, rects: toThumbRects(summary.boxes) };
    }
    for (const [id, nodes] of Object.entries(loadedNodes)) {
      result[id] = { nodeCount: nodes.length, rects: toThumbRects(nodes) };
    }
    return result;
  }, [stored, loadedNodes]);

  useEffect(() => {
    const agent = window.canvasWorkspace?.agent;
    if (!agent) return;
    let cancelled = false;
    const names = Object.fromEntries(workspaces.map((workspace) => [workspace.id, workspace.name]));
    void agent.listAllSessions(names).then((result) => {
      if (cancelled || !result.ok) return;
      const chats = (result.groups ?? []).flatMap((group) => group.sessions
        .filter((session) => session.messageCount > 0)
        .map((session) => ({
          storeId: group.workspaceId,
          scopeName: names[group.workspaceId] ?? globalName,
          session,
        })));
      chats.sort((a, b) => (b.session.updatedAt ?? 0) - (a.session.updatedAt ?? 0));
      setRecentChats(chats.slice(0, RECENT_CHAT_LIMIT));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceKey, globalName]);

  return { recentWorkspaces, summaries, recentChats };
};
