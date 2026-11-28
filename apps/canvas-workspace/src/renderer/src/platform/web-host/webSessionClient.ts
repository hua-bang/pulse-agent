import type { PulseStorage } from '@pulse-coder/storage';
import type { AgentSessionInfo, CrossWorkspaceSessionGroup } from '../../../../shared/agent-chat';
import type { CanvasWorkspaceApi } from '../../../../shared/api/workspace-api';
import { extractConversationMessages, scopeIdFromRef } from './remotePaths';
import type { WebHostAuthSession } from './types';

type WebSessionMethods = Pick<
  CanvasWorkspaceApi['agent'],
  'listSessions' | 'listAllSessions' | 'getCurrentSession' | 'getHistory' | 'loadSession'
>;

export function createWebSessionClient(
  session: WebHostAuthSession,
  getStorage: () => Promise<PulseStorage>,
  getCurrentWorkspaceId: () => string | undefined,
): WebSessionMethods {
  const draftSessionByScope = new Map<string, string>();
  const getOrMintDraftSession = (scopeId: string): string => {
    let id = draftSessionByScope.get(scopeId);
    if (!id) {
      id = `vps-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      draftSessionByScope.set(scopeId, id);
    }
    return id;
  };

  const listScopeSessions = async (storage: PulseStorage, scopeId: string): Promise<AgentSessionInfo[]> => {
    const scope = await storage.conversationScopes.read(scopeId);
    const allItems: Array<{ sessionId: string; metadata?: Record<string, unknown> }> = [];
    let cursor: string | undefined;
    do {
      const page = await storage.conversations.list(scopeId, { cursor, limit: 200 });
      for (const item of page.items) {
        allItems.push({
          sessionId: item.sessionId,
          metadata: (item.metadata ?? {}) as Record<string, unknown>,
        });
      }
      cursor = page.nextCursor;
    } while (cursor);
    const currentId = scope?.currentSessionId ?? allItems[0]?.sessionId ?? null;
    return allItems
      .map((item) => {
        const meta = item.metadata ?? {};
        return {
          sessionId: item.sessionId,
          date: typeof meta.date === 'string' ? meta.date : new Date().toISOString().slice(0, 10),
          updatedAt: typeof meta.updatedAt === 'number' ? meta.updatedAt : undefined,
          messageCount: typeof meta.messageCount === 'number' ? meta.messageCount : 0,
          isCurrent: item.sessionId === currentId,
          title: typeof meta.title === 'string' ? meta.title : undefined,
          preview: typeof meta.preview === 'string' ? meta.preview : undefined,
          pinned: typeof meta.pinned === 'boolean' ? meta.pinned : undefined,
        };
      })
      .filter((entry) => entry.messageCount > 0)
      .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  };

  return {
    listSessions: async (scopeRef) => {
      try {
        const scopeId = scopeIdFromRef(scopeRef, getCurrentWorkspaceId());
        if (session.workspaceId && scopeId !== session.workspaceId) {
          return { ok: true, sessions: [] };
        }
        const storage = await getStorage();
        const sessions = await listScopeSessions(storage, scopeId);
        return { ok: true, sessions };
      } catch (err) {
        return { ok: false, sessions: [], error: err instanceof Error ? err.message : String(err) };
      }
    },
    listAllSessions: async (workspaceNames) => {
      try {
        const storage = await getStorage();
        const activeWs = getCurrentWorkspaceId();
        const scopeIds = session.workspaceId
          ? [session.workspaceId]
          : Array.from(new Set([...Object.keys(workspaceNames ?? {}), ...(activeWs ? [activeWs] : [])])).filter(Boolean);
        const groups: CrossWorkspaceSessionGroup[] = [];
        await Promise.all(
          scopeIds.map(async (scopeId) => {
            try {
              const sessions = await listScopeSessions(storage, scopeId);
              if (sessions.length > 0 || scopeId === activeWs) {
                groups.push({
                  workspaceId: scopeId,
                  workspaceName: workspaceNames?.[scopeId] || scopeId,
                  sessions,
                });
              }
            } catch {
              // Skip scopes inaccessible to the current token or without conversations yet.
            }
          }),
        );
        return { ok: true, groups };
      } catch (err) {
        return { ok: false, groups: [], error: err instanceof Error ? err.message : String(err) };
      }
    },
    getCurrentSession: async (scopeRef) => {
      try {
        const scopeId = scopeIdFromRef(scopeRef, getCurrentWorkspaceId());
        if (session.workspaceId && scopeId !== session.workspaceId) return { ok: true, sessionId: null };
        const storage = await getStorage();
        const scope = await storage.conversationScopes.read(scopeId);
        if (scope?.currentSessionId) return { ok: true, sessionId: scope.currentSessionId };
        const page = await storage.conversations.list(scopeId, { limit: 1 });
        return { ok: true, sessionId: page.items[0]?.sessionId ?? getOrMintDraftSession(scopeId) };
      } catch (err) {
        return { ok: false, sessionId: null, error: err instanceof Error ? err.message : String(err) };
      }
    },
    getHistory: async (scopeRef) => {
      try {
        const scopeId = scopeIdFromRef(scopeRef, getCurrentWorkspaceId());
        if (session.workspaceId && scopeId !== session.workspaceId) {
          return { ok: true, messages: [], activeSessionId: null };
        }
        const storage = await getStorage();
        const scope = await storage.conversationScopes.read(scopeId);
        let activeId = scope?.currentSessionId ?? null;
        if (!activeId) {
          const page = await storage.conversations.list(scopeId, { limit: 1 });
          activeId = page.items[0]?.sessionId ?? null;
        }
        if (!activeId) return { ok: true, messages: [], activeSessionId: getOrMintDraftSession(scopeId) };
        const conv = await storage.conversations.read(scopeId, activeId);
        return {
          ok: true,
          messages: conv ? extractConversationMessages(conv as unknown as { messages?: unknown[] }) : [],
          activeSessionId: activeId,
        };
      } catch {
        return { ok: true, messages: [], activeSessionId: null };
      }
    },
    loadSession: async (scopeRef, sessionId) => {
      try {
        const scopeId = scopeIdFromRef(scopeRef, getCurrentWorkspaceId());
        if (session.workspaceId && scopeId !== session.workspaceId) {
          return { ok: true, messages: [], activeSessionId: sessionId };
        }
        const storage = await getStorage();
        const conv = await storage.conversations.read(scopeId, sessionId);
        const scope = await storage.conversationScopes.read(scopeId).catch(() => null);
        if (scope?.currentSessionId !== sessionId) {
          await storage.conversationScopes
            .commit({
              scopeId,
              expectedRevision: scope?.revision ?? null,
              currentSessionId: sessionId,
            })
            .catch(() => {});
        }
        return {
          ok: true,
          messages: conv ? extractConversationMessages(conv as unknown as { messages?: unknown[] }) : [],
          activeSessionId: sessionId,
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
