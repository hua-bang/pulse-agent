/**
 * Session IPC for the Canvas Agent: history, session lists, and session
 * create, branch, rename, pin, delete, rewind, and load. The channel list is
 * in ../../ipc.ts.
 */

import { ipcMain } from 'electron';
import { getCanvasAgentService } from '../../agent-service-lifecycle';
import { resolveAgentScope } from '../../mcp-apps/mcp-app-request';
import type { AgentScopeRef } from '../../types';

export function setupCanvasAgentSessionIpc(): void {
  ipcMain.handle(
    'canvas-agent:history',
    async (_event, payload: AgentScopeRef) => {
      try {
        const scope = resolveAgentScope(payload);
        const svc = await getCanvasAgentService();
        const snapshot = await svc.getHistorySnapshotForScope(scope);
        return { ok: true, ...snapshot };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    'canvas-agent:sessions',
    async (_event, payload: AgentScopeRef) => {
      try {
        const svc = await getCanvasAgentService();
        const sessions = await svc.listSessionsForScope(resolveAgentScope(payload));
        return { ok: true, sessions };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    'canvas-agent:new-session',
    async (_event, payload: AgentScopeRef) => {
      try {
        const scope = resolveAgentScope(payload);
        const svc = await getCanvasAgentService();
        return await svc.newSessionForScope(scope);
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    'canvas-agent:branch-session',
    async (_event, payload: AgentScopeRef & { fromIndex: number; sourceSessionId?: string }) => {
      const scope = resolveAgentScope(payload);
      const svc = await getCanvasAgentService();
      return svc.branchSessionForScope(scope, payload.fromIndex, payload.sourceSessionId);
    },
  );

  ipcMain.handle(
    'canvas-agent:rename-session',
    async (_event, payload: AgentScopeRef & { sessionId: string; title: string }) => {
      const scope = resolveAgentScope(payload);
      const svc = await getCanvasAgentService();
      return svc.renameSessionForScope(scope, payload.sessionId, payload.title);
    },
  );

  ipcMain.handle(
    'canvas-agent:set-session-pinned',
    async (_event, payload: AgentScopeRef & { sessionId: string; pinned: boolean }) => {
      const scope = resolveAgentScope(payload);
      const svc = await getCanvasAgentService();
      return svc.setSessionPinnedForScope(scope, payload.sessionId, payload.pinned);
    },
  );

  ipcMain.handle(
    'canvas-agent:delete-session',
    async (_event, payload: AgentScopeRef & { sessionId: string }) => {
      try {
        const scope = resolveAgentScope(payload);
        const svc = await getCanvasAgentService();
        return await svc.deleteSessionForScope(scope, payload.sessionId);
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    'canvas-agent:rewind-messages',
    async (_event, payload: AgentScopeRef & { fromIndex: number }) => {
      try {
        const scope = resolveAgentScope(payload);
        const svc = await getCanvasAgentService();
        return await svc.rewindMessagesForScope(scope, payload.fromIndex);
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    'canvas-agent:load-session',
    async (_event, payload: AgentScopeRef & { sessionId: string }) => {
      try {
        const scope = resolveAgentScope(payload);
        const svc = await getCanvasAgentService();
        return await svc.loadSessionForDisplayScope(scope, payload.sessionId);
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    'canvas-agent:all-sessions',
    async (_event, payload: { workspaceNames: Record<string, string> }) => {
      try {
        const svc = await getCanvasAgentService();
        const groups = await svc.listAllSessions(payload.workspaceNames);
        return { ok: true, groups };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    'canvas-agent:current-session',
    async (_event, payload: AgentScopeRef) => {
      try {
        const svc = await getCanvasAgentService();
        const sessionId = await svc.resolveCurrentSessionId(resolveAgentScope(payload));
        return { ok: true, sessionId };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    'canvas-agent:search-sessions',
    async (_event, payload: { query: string; limit?: number }) => {
      try {
        const svc = await getCanvasAgentService();
        const hits = await svc.searchSessions(payload.query ?? '', payload.limit);
        return { ok: true, hits };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    'canvas-agent:load-cross-workspace-session',
    async (_event, payload: { targetWorkspaceId: string; sourceWorkspaceId: string; sessionId: string }) => {
      try {
        const svc = await getCanvasAgentService();
        return await svc.loadCrossWorkspaceSession(
          payload.targetWorkspaceId,
          payload.sourceWorkspaceId,
          payload.sessionId,
        );
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );
}
