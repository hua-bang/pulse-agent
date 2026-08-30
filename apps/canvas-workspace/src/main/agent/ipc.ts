/**
 * IPC handlers for the Canvas Agent.
 *
 * Channels:
 *   canvas-agent:prepare-chat      — allocate one run id before listeners subscribe
 *   canvas-agent:start-chat        — start that prepared run
 *   canvas-agent:cancel-prepared-chat — release an abandoned prepared run
 *   canvas-agent:run-status        — report whether main still owns the run
 *   canvas-agent:scope-run-status  — reconnect to a scope run and pending clarification
 *   canvas-agent:chat              — backwards-compatible prepare + start
 *   canvas-agent:observability-mark — record a renderer-owned UI milestone
 *   canvas-agent:abort             — interrupt the currently-running chat turn (hard stop)
 *   canvas-agent:stop-relay        — graceful multi-role relay stop: current segment
 *                                    finishes, queued segments are skipped
 *   canvas-agent:clarify-answer    — deliver a user reply to a pending clarification
 *   canvas-agent:status            — check if agent is active
 *   canvas-agent:list-skills       — list skills (name + description) for the / popup
 *   canvas-agent:history           — get current session messages
 *   canvas-agent:sessions          — list all sessions (current + archived)
 *   canvas-agent:new-session       — start a new session
 *   canvas-agent:branch-session    — create and activate a durable history branch
 *   canvas-agent:rename-session    — update a session title
 *   canvas-agent:set-session-pinned — pin or unpin a session
 *   canvas-agent:delete-session    — delete a session with safe pointer replacement
 *   canvas-agent:load-session      — load an archived session
 *   canvas-agent:activate          — explicitly start the agent
 *   canvas-agent:deactivate        — stop the agent and archive session
 *
 * Streaming:
 *   prepare-chat returns { ok, sessionId }; start-chat begins only after the
 *   renderer installs every run-scoped listener.
 *   Text deltas arrive on         `canvas-agent:text-delta:{sessionId}`.
 *   Tool call starts arrive on    `canvas-agent:tool-call:{sessionId}`.
 *   Tool results arrive on        `canvas-agent:tool-result:{sessionId}`.
 *   Clarification requests arrive on `canvas-agent:clarify-request:{sessionId}`.
 *   Segment starts arrive on      `canvas-agent:role-turn-start:{sessionId}`
 *     (every turn emits them, total=1 for single-speaker turns; a multi-role
 *     relay emits one per segment with the full queue for progress UI).
 *   Segment completions arrive on `canvas-agent:role-turn-end:{sessionId}`
 *     (successful segments only — a failed segment surfaces through
 *     chat-complete's error instead).
 *   Completion arrives on         `canvas-agent:chat-complete:{sessionId}`.
 */

import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'crypto';
import { CanvasAgentService } from './service';
import { streamWorkspaceDoc } from './workspace-doc-generator';
import { generateScheduledPrompt } from './scheduled-prompt-generator';
import { appendImageNodeToCanvas } from '../canvas/service';
import type { AgentScopeRef } from './types';
import {
  PreparedChatRegistry,
  type PreparedChatPayload,
} from './prepared-chat';
import { ActiveChatRegistry } from './active-chat-registry';
import { prepareChatTurn, startChatTurn } from './chat-protocol';
import type { AgentObservabilityMarkInput } from '../../shared/agent-observability';
import { publishAgentTraceEvent } from '../../plugins/main';
import { isAgentObservabilityMark } from './observability/renderer-mark';
import { resolveAgentScope, setupMcpAppIpc } from './mcp-app-ipc';
let service: CanvasAgentService | null = null;
const activeChats = new ActiveChatRegistry();
const preparedChats = new PreparedChatRegistry();
export function getCanvasAgentService(): CanvasAgentService {
  if (!service) {
    service = new CanvasAgentService();
  }
  return service;
}

function getService(): CanvasAgentService {
  return getCanvasAgentService();
}

export function setupCanvasAgentIpc(): void {
  const svc = getService();
  setupMcpAppIpc(svc);

  ipcMain.handle(
    'canvas-agent:polish-scheduled-prompt',
    async (_event, payload: { title?: string; currentPrompt?: string }) => {
      const title = payload?.title?.trim() ?? '';
      const currentPrompt = payload?.currentPrompt?.trim();
      if (!title && !currentPrompt) {
        return { ok: false, error: 'Task name or instructions are required' };
      }
      return generateScheduledPrompt(title, currentPrompt);
    },
  );

  const prepare = async (
    event: IpcMainInvokeEvent,
    payload: PreparedChatPayload & AgentScopeRef,
  ) => prepareChatTurn({
    sender: event.sender,
    scope: resolveAgentScope(payload),
    payload,
    activeChats,
    preparedChats,
  });

  const start = (event: IpcMainInvokeEvent, sessionId: string) => startChatTurn({
    sender: event.sender,
    sessionId,
    service: svc,
    activeChats,
    preparedChats,
  });

  ipcMain.handle('canvas-agent:prepare-chat', (event, payload) => prepare(event, payload));
  ipcMain.handle(
    'canvas-agent:observability-mark',
    (_event, payload: AgentObservabilityMarkInput) => {
      if (!isAgentObservabilityMark(payload)) {
        return { ok: false, error: 'Invalid observability milestone' };
      }
      publishAgentTraceEvent({ type: 'milestone', owner: 'renderer', ...payload });
      return { ok: true };
    },
  );
  ipcMain.handle(
    'canvas-agent:start-chat',
    (event, payload: { sessionId: string }) => start(event, payload.sessionId),
  );
  ipcMain.handle(
    'canvas-agent:cancel-prepared-chat',
    (event, payload: { sessionId: string }) => ({
      ok: preparedChats.discard(payload.sessionId, event.sender),
    }),
  );

  // Backwards-compatible one-step entry for older renderer bundles. Current
  // clients use prepare → subscribe → start and therefore have no event-loss
  // window.
  ipcMain.handle('canvas-agent:chat', async (event, payload) => {
    const result = await prepare(event, payload);
    if (!result.ok || !result.sessionId) return result;
    const started = await start(event, result.sessionId);
    return started.ok ? result : { ...started, sessionId: result.sessionId };
  });

  ipcMain.handle(
    'canvas-agent:abort',
    (_event, payload: { sessionId?: string; workspaceId?: string }) => {
      if (payload.sessionId && activeChats.abort(payload.sessionId)) {
        return { ok: true };
      }
      const workspaceId = payload.workspaceId;
      if (!workspaceId) return { ok: false, error: 'No active run for sessionId' };
      // Legacy fallback: abort the most recent run for the workspace.
      svc.abort(workspaceId);
      return { ok: true };
    },
  );

  ipcMain.handle('canvas-agent:run-status', (
    _event,
    payload: { sessionId: string; afterSequence?: number },
  ) => {
    const replay = payload.afterSequence === undefined ? undefined
      : activeChats.readStreamEvents(payload.sessionId, payload.afterSequence);
    return { ok: true, active: activeChats.has(payload.sessionId), ...(replay ? { replay } : {}) };
  });

  ipcMain.handle(
    'canvas-agent:scope-run-status',
    (_event, payload: AgentScopeRef & { sessionId?: string }) => {
      const scope = resolveAgentScope(payload);
      // Per-session busy: the renderer asks about the conversation it is
      // currently showing. A different conversation streaming in the same
      // workspace does NOT make this one busy (parallel conversations).
      const conversationSessionId = payload.sessionId
        ?? activeChats.conversationSessionIdForScope(scope);
      const runSessionId = activeChats.runSessionIdForConversation(scope, conversationSessionId);
      return {
        ok: true,
        active: Boolean(runSessionId),
        sessionId: runSessionId,
        conversationSessionId: activeChats.hasConversationSession(scope, conversationSessionId)
          ? conversationSessionId
          : undefined,
        pendingClarification: runSessionId
          ? svc.getPendingClarificationForScope(scope, conversationSessionId ?? undefined) ?? undefined
          : undefined,
      };
    },
  );

  ipcMain.handle(
    'canvas-agent:scope-run-sessions',
    (_event, payload: AgentScopeRef) => {
      const scope = resolveAgentScope(payload);
      return {
        ok: true,
        conversationSessionIds: activeChats.allConversationSessionIdsForScope(scope),
      };
    },
  );

  ipcMain.handle(
    'canvas-agent:stop-relay',
    (_event, payload: { sessionId: string }) => {
      const scope = payload.sessionId ? activeChats.scopeOf(payload.sessionId) : undefined;
      if (!scope) return { ok: false, error: 'No active run for sessionId' };
      const conversationSessionId = activeChats.conversationSessionIdOf(payload.sessionId);
      const stopped = svc.stopRelayForScope(scope, conversationSessionId);
      return { ok: stopped, error: stopped ? undefined : 'No relay in flight' };
    },
  );

  ipcMain.handle(
    'canvas-agent:clarify-answer',
    (
      _event,
      payload: { sessionId: string; requestId: string; answer: string },
    ) => {
      const scope = activeChats.scopeOf(payload.sessionId);
      if (!scope) return { ok: false, error: 'No active run for sessionId' };
      const matched = svc.answerClarificationForScope(scope, payload.requestId, payload.answer);
      return { ok: matched, error: matched ? undefined : 'No pending clarification matched' };
    },
  );


  ipcMain.handle(
    'canvas-agent:add-image-to-canvas',
    async (_event, payload: { workspaceId: string; imagePath: string; title?: string }) => {
      try {
        const { nodeId } = await appendImageNodeToCanvas(payload);
        return { ok: true, nodeId };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    'canvas-agent:status',
    (_event, payload: AgentScopeRef) => {
      return svc.getStatusForScope(resolveAgentScope(payload));
    },
  );

  ipcMain.handle(
    'canvas-agent:list-skills',
    async (_event, payload: AgentScopeRef) => {
      try {
        const skills = await svc.listSkillsForScope(resolveAgentScope(payload));
        return { ok: true, skills };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    'canvas-agent:history',
    async (_event, payload: AgentScopeRef) => {
      try {
        const scope = resolveAgentScope(payload);
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
        return await svc.newSessionForScope(scope);
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    'canvas-agent:branch-session',
    async (_event, payload: AgentScopeRef & { fromIndex: number }) => {
      const scope = resolveAgentScope(payload);
      return svc.branchSessionForScope(scope, payload.fromIndex);
    },
  );

  ipcMain.handle(
    'canvas-agent:rename-session',
    async (_event, payload: AgentScopeRef & { sessionId: string; title: string }) => {
      const scope = resolveAgentScope(payload);
      return svc.renameSessionForScope(scope, payload.sessionId, payload.title);
    },
  );

  ipcMain.handle(
    'canvas-agent:set-session-pinned',
    async (_event, payload: AgentScopeRef & { sessionId: string; pinned: boolean }) => {
      const scope = resolveAgentScope(payload);
      return svc.setSessionPinnedForScope(scope, payload.sessionId, payload.pinned);
    },
  );

  ipcMain.handle(
    'canvas-agent:delete-session',
    async (_event, payload: AgentScopeRef & { sessionId: string }) => {
      try {
        const scope = resolveAgentScope(payload);
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

  ipcMain.handle(
    'canvas-agent:activate',
    async (_event, payload: { workspaceId: string }) => {
      try {
        await svc.activate(payload.workspaceId);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    'canvas-agent:deactivate',
    async (_event, payload: { workspaceId: string }) => {
      try {
        const scope = { kind: 'workspace' as const, workspaceId: payload.workspaceId };
        if (activeChats.hasScope(scope)) {
          return {
            ok: false,
            code: 'CHAT_SCOPE_BUSY',
            error: 'Another reply is already running for this chat scope.',
          };
        }
        await svc.deactivate(payload.workspaceId);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  // ── Workspace doc one-shot generation (user-triggered from settings) ──
  // The renderer subscribes to delta + complete events keyed by requestId
  // returned synchronously from the invoke. Mirrors the llm:stream-html
  // pattern. Never invoked from the agent loop.
  ipcMain.handle(
    'canvas-agent:stream-workspace-doc',
    (
      event,
      payload: { workspaceName: string; intent: string; currentContent?: string },
    ) => {
      if (!payload?.intent?.trim()) {
        return { ok: false, error: 'Intent is required' };
      }
      const requestId = randomUUID();
      const sender = event.sender;

      void (async () => {
        try {
          const result = await streamWorkspaceDoc(
            payload.workspaceName?.trim() || 'Workspace',
            payload.intent.trim(),
            payload.currentContent,
            (delta) => {
              if (!sender.isDestroyed()) {
                sender.send(`canvas-agent:workspace-doc-delta:${requestId}`, delta);
              }
            },
          );
          if (!sender.isDestroyed()) {
            sender.send(`canvas-agent:workspace-doc-complete:${requestId}`, result);
          }
        } catch (err) {
          if (!sender.isDestroyed()) {
            sender.send(`canvas-agent:workspace-doc-complete:${requestId}`, {
              ok: false,
              error: String(err),
            });
          }
        }
      })();

      return { ok: true, requestId };
    },
  );
}

export function teardownCanvasAgent(): void {
  preparedChats.clear();
  activeChats.clear();
  if (service) {
    void service.deactivateAll();
    service = null;
  }
}
