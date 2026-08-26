import { ipcMain, type WebContents } from 'electron';
import type { AgentScope, AgentScopeRef } from '../types';
import type { CanvasAgent } from '../canvas-agent';
import type { CanvasAgentService } from '../service';
import { ConversationRuntimeService } from './conversation-service';
import type { AgentRequestContext, ChatImageAttachment } from '../../../shared/agent-chat';
import { isPerfChatReplayRequest, replayPerfChatStream } from '../perf-chat-replay';

let service: ConversationRuntimeService | null = null;

const resolveScope = (payload: AgentScopeRef): AgentScope => {
  if (payload.scope?.kind === 'global') return { kind: 'global' };
  if (payload.scope?.kind === 'scheduled' && payload.scope.taskId) {
    return { kind: 'scheduled', taskId: payload.scope.taskId };
  }
  if (payload.scope?.kind === 'workspace' && payload.scope.workspaceId) {
    return { kind: 'workspace', workspaceId: payload.scope.workspaceId };
  }
  return { kind: 'global' };
};

const send = (sender: WebContents, channel: string, sessionId: string, data: unknown): void => {
  if (!sender.isDestroyed()) sender.send(`canvas-agent:${channel}:${sessionId}`, data);
};

export interface ConversationRuntimeChatPayload {
  scope: AgentScope;
  sessionId: string;
  message: string;
  mentionedWorkspaceIds?: string[];
  requestContext?: AgentRequestContext;
  attachments?: ChatImageAttachment[];
}

/**
 * IPC surface for the conversation-runtime path. The renderer drives a
 * conversation by key (scope + sessionId) and receives the same per-session
 * stream events as the legacy protocol, so the existing renderer listeners
 * work unchanged while main owns per-conversation state.
 */
export function setupConversationRuntimeIpc(getService: () => CanvasAgentService): void {
  const ensure = (): ConversationRuntimeService => {
    if (!service) {
      const agentService = getService();
      service = new ConversationRuntimeService(
        (scope) => agentService.getAgentForScope(scope),
        (_storeId, scope) => ({
          loadMessages: async (sessionId) => (
            await agentService.sessionMutations.readConversation(scope, sessionId) ?? []
          ),
          persist: (sessionId, messages) => (
            agentService.sessionMutations.replaceConversationMessages(scope, sessionId, messages)
          ),
        }),
        (scope, sessionId, operation) => (
          agentService.sessionMutations.runChat(scope, operation, sessionId)
        ),
        (scope) => agentService.activateScope(scope),
      );
    }
    return service;
  };

  ipcMain.handle(
    'canvas-agent:conversation-chat',
    (
      event,
      payload: ConversationRuntimeChatPayload,
    ) => {
      const runtime = ensure();
      const { scope, sessionId, message, mentionedWorkspaceIds, requestContext, attachments } = payload;
      if (isPerfChatReplayRequest(message, process.env.PULSE_CANVAS_PERF === '1')) {
        void replayPerfChatStream(event.sender, sessionId);
        return { ok: true, sessionId };
      }
      const completion = runtime.chat(scope, sessionId, message, {
        onText: (delta) => send(event.sender, 'text-delta', sessionId, delta),
        onToolCall: (data) => send(event.sender, 'tool-call', sessionId, data),
        onToolResult: (data) => send(event.sender, 'tool-result', sessionId, data),
        onToolInputStart: (data) => send(event.sender, 'tool-input-start', sessionId, data),
        onToolInputDelta: (data) => send(event.sender, 'tool-input-delta', sessionId, data),
        onToolInputEnd: (data) => send(event.sender, 'tool-input-end', sessionId, data),
        onClarificationRequest: (req) => send(event.sender, 'clarify-request', sessionId, req),
        onRoleTurnStart: (ev) => send(event.sender, 'role-turn-start', sessionId, ev),
        onRoleTurnEnd: (ev) => send(event.sender, 'role-turn-end', sessionId, ev),
      }, {
        mentionedWorkspaceIds,
        requestContext,
        attachments,
      });
      void completion.then(
        result => send(event.sender, 'chat-complete', sessionId, result),
        error => send(event.sender, 'chat-complete', sessionId, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return { ok: true, sessionId };
    },
  );

  ipcMain.handle(
    'canvas-agent:conversation-abort',
    (_event, payload: { scope: AgentScope; sessionId: string }) => {
      return { ok: ensure().abort(payload.scope, payload.sessionId) };
    },
  );

  ipcMain.handle(
    'canvas-agent:conversation-running-sessions',
    (_event, payload: { scope: AgentScope }) => ({
      ok: true,
      conversationSessionIds: ensure().runningSessionIds(resolveScope(payload)),
    }),
  );

  ipcMain.handle(
    'canvas-agent:conversation-stop-relay',
    (_event, payload: { scope: AgentScope; sessionId: string }) => {
      return { ok: ensure().stopRelay(payload.scope, payload.sessionId) };
    },
  );

  ipcMain.handle(
    'canvas-agent:conversation-clarify-answer',
    (_event, payload: { scope: AgentScope; sessionId: string; requestId: string; answer: string }) => {
      return {
        ok: ensure().answerClarification(
          payload.scope, payload.sessionId, payload.requestId, payload.answer,
        ),
      };
    },
  );
}

export function teardownConversationRuntime(): void {
  service?.disposeAll();
  service = null;
}
