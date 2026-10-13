import { useEffect, useMemo, useState } from 'react';
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

/**
 * What the launcher shows: summaries of workspaces whose nodes this window
 * already holds, and the most recent chats across all scopes. It never loads
 * a canvas itself: `store.load` returns full node payloads and starts file
 * watchers, so an unopened workspace simply gets no preview.
 */
export const useLauncherData = (
  workspaces: WorkspaceEntry[],
  loadedNodes: Record<string, NodeBox[]>,
  globalName: string,
) => {
  const [recentChats, setRecentChats] = useState<RecentChat[] | null>(null);
  const workspaceKey = workspaces.map((workspace) => workspace.id).join('|');
  const summaries = useMemo(() => {
    const result: Record<string, WorkspaceSummary> = {};
    for (const [id, nodes] of Object.entries(loadedNodes)) {
      result[id] = { nodeCount: nodes.length, rects: toThumbRects(nodes) };
    }
    return result;
  }, [loadedNodes]);

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
