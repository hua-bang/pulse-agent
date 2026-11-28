import type { AgentChatMessage, AgentScopeRef } from '../../../../shared/agent-chat';
import type { CanvasSummaryBox } from '../../../../shared/canvas';

export function extractConversationMessages(snapshot: {
  messages?: unknown[];
  entries?: Array<{ data?: unknown }>;
}): AgentChatMessage[] {
  if (Array.isArray(snapshot.messages)) {
    return snapshot.messages as AgentChatMessage[];
  }
  if (Array.isArray(snapshot.entries)) {
    return snapshot.entries
      .map((entry) => entry?.data)
      .filter((item): item is AgentChatMessage => Boolean(item && typeof item === 'object'));
  }
  return [];
}

export function toSummaryBox(node: {
  type?: string;
  title?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}): CanvasSummaryBox {
  return {
    type: node.type ?? 'text',
    ...(node.title ? { title: node.title.slice(0, 60) } : {}),
    x: typeof node.x === 'number' ? node.x : 0,
    y: typeof node.y === 'number' ? node.y : 0,
    width: typeof node.width === 'number' ? node.width : 240,
    height: typeof node.height === 'number' ? node.height : 160,
  };
}

export function scopeIdFromRef(scopeRef: AgentScopeRef, fallbackWorkspaceId?: string): string {
  if (typeof scopeRef === 'string') return scopeRef;
  if (scopeRef && typeof scopeRef === 'object') {
    if ('scope' in scopeRef && scopeRef.scope && typeof scopeRef.scope === 'object') {
      const inner = scopeRef.scope;
      if (inner.kind === 'workspace' && inner.workspaceId) return inner.workspaceId;
      if (inner.kind === 'scheduled' && inner.taskId) return `scheduled:${inner.taskId}`;
      if (inner.kind === 'global') return fallbackWorkspaceId || 'global';
    }
    const legacyWs = (scopeRef as { workspaceId?: unknown }).workspaceId;
    if (typeof legacyWs === 'string' && legacyWs) {
      return legacyWs;
    }
  }
  return fallbackWorkspaceId || 'global';
}

function hasPathTraversal(rel: string): boolean {
  return rel.includes('\0') || rel.split('/').some((seg) => seg === '..');
}

export function toRemoteFileUri(
  filePath: string,
  activeWorkspaceId?: string,
  lockedWorkspaceId?: string,
): string | null {
  const normalized = filePath.trim().replace(/\\/g, '/');
  if (!normalized || normalized.includes('\0')) return null;

  if (normalized.startsWith('pulse-remote://')) {
    const rel = normalized.slice('pulse-remote://'.length).replace(/^\/+/, '');
    if (!rel || hasPathTraversal(rel)) return null;
    if (lockedWorkspaceId && !rel.startsWith(`${lockedWorkspaceId}/`)) return null;
    return `pulse-remote:///${rel}`;
  }

  if (normalized.startsWith('vps://')) {
    const rel = normalized.slice('vps://'.length).replace(/^\/+/, '');
    if (!rel || hasPathTraversal(rel)) return null;
    if (lockedWorkspaceId && !rel.startsWith(`${lockedWorkspaceId}/`)) return null;
    return `pulse-remote:///${rel}`;
  }

  const targetWs = lockedWorkspaceId || activeWorkspaceId;

  // Absolute local paths stored in desktop-authored canvas nodes (e.g. `/Users/.../ws-123/notes/foo.md`).
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    if (targetWs) {
      const marker = `/${targetWs}/`;
      const idx = normalized.lastIndexOf(marker);
      if (idx >= 0) {
        const rel = normalized.slice(idx + marker.length).replace(/^\/+/, '');
        if (rel && !hasPathTraversal(rel)) {
          return `pulse-remote:///${targetWs}/${rel}`;
        }
      }
    }
    if (!lockedWorkspaceId) {
      const wsMatch = /\/(ws-[A-Za-z0-9_-]+)\/(.+)$/.exec(normalized);
      if (wsMatch && !hasPathTraversal(wsMatch[2])) {
        return `pulse-remote:///${wsMatch[1]}/${wsMatch[2]}`;
      }
    }
    if (targetWs) {
      const subMatch = /\/((?:notes|assets|files)\/.+)$/.exec(normalized);
      if (subMatch && !hasPathTraversal(subMatch[1])) {
        return `pulse-remote:///${targetWs}/${subMatch[1]}`;
      }
    }
    return null;
  }

  // Relative workspace path (e.g. `notes/foo.md`).
  if (normalized.includes('://')) return null;
  if (!targetWs) return null;
  const cleanRel = normalized.replace(/^\.\/+/, '');
  if (!cleanRel || hasPathTraversal(cleanRel)) return null;
  if (cleanRel.startsWith(`${targetWs}/`)) {
    return `pulse-remote:///${cleanRel}`;
  }
  return `pulse-remote:///${targetWs}/${cleanRel}`;
}

export function normalizeCanvasData<T extends { edges?: unknown[] } | null>(data: T): T {
  if (!data || !Array.isArray(data.edges)) return data;
  let changed = false;
  const edges = data.edges
    .map((raw) => {
      if (!raw || typeof raw !== 'object') {
        changed = true;
        return null;
      }
      const edge = raw as Record<string, unknown>;
      const hasSource = Boolean(edge.source && typeof edge.source === 'object' && 'kind' in edge.source);
      const hasTarget = Boolean(edge.target && typeof edge.target === 'object' && 'kind' in edge.target);
      if (hasSource && hasTarget) return edge;
      const fromId = typeof edge.fromNode === 'string' ? edge.fromNode.trim() : '';
      const toId = typeof edge.toNode === 'string' ? edge.toNode.trim() : '';
      if (!fromId && !hasSource) {
        changed = true;
        return null;
      }
      if (!toId && !hasTarget) {
        changed = true;
        return null;
      }
      changed = true;
      return {
        ...edge,
        source: hasSource ? edge.source : { kind: 'node', nodeId: fromId },
        target: hasTarget ? edge.target : { kind: 'node', nodeId: toId },
      };
    })
    .filter((e): e is Record<string, unknown> => e !== null);
  return changed ? ({ ...data, edges } as T) : data;
}
