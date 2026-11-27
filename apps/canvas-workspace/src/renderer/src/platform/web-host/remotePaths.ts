import type { AgentScopeRef } from '../../../../shared/agent-chat';

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
