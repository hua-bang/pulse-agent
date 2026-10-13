import { useEffect, useState } from 'react';
import type { WorkspaceEntry } from '../../../shared/workspaces';
import type { AgentSessionInfo } from '../../../../../shared/agent-chat';

const THUMB_NODE_LIMIT = 6;
const RECENT_CHAT_LIMIT = 6;
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
  savedAt: number;
  rects: ThumbRect[];
}

export interface RecentChat {
  storeId: string;
  scopeName: string;
  session: AgentSessionInfo;
}

type NodeBox = { type: string; x: number; y: number; width: number; height: number };

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

/**
 * Loads what the launcher shows: a summary per workspace (node count, last
 * save, thumbnail boxes) and the most recent chats across all scopes.
 */
export const useLauncherData = (workspaces: WorkspaceEntry[], globalName: string) => {
  const [summaries, setSummaries] = useState<Record<string, WorkspaceSummary>>({});
  const [recentChats, setRecentChats] = useState<RecentChat[] | null>(null);
  const workspaceKey = workspaces.map((workspace) => workspace.id).join('|');

  useEffect(() => {
    const store = window.canvasWorkspace?.store;
    if (!store) return;
    let cancelled = false;
    for (const workspace of workspaces) {
      void store.load(workspace.id).then((result) => {
        if (cancelled || !result.ok) return;
        // A workspace that was never saved has no data yet: it is empty.
        const nodes = Array.isArray(result.data?.nodes) ? result.data.nodes : [];
        const summary: WorkspaceSummary = {
          nodeCount: nodes.length,
          savedAt: Date.parse(result.data?.savedAt ?? '') || 0,
          rects: toThumbRects(nodes),
        };
        setSummaries((prev) => ({ ...prev, [workspace.id]: summary }));
      });
    }
    return () => {
      cancelled = true;
    };
    // Reload only when the set of workspaces changes, not on every rename.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceKey]);

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

  return { summaries, recentChats };
};
