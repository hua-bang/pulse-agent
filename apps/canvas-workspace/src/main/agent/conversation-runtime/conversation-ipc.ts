import {
  conversationKey,
  conversationKeyId,
  type ConversationSendInput,
} from '../../../shared/conversation-runtime';
import { ipcMain, type WebContents } from 'electron';
import { SessionStore } from '../sessions/store/session-store';
import type { AgentScope, AgentScopeRef } from '../types';
import type { CanvasAgent } from '../canvas-agent';
import type { CanvasAgentService } from '../service';
import { ConversationRuntimeService } from './conversation-service';
import type { AgentRequestContext, ChatImageAttachment } from '../../../shared/agent-chat';
import { isPerfChatReplayRequest, replayPerfChatStream } from '../run/perf-chat-replay';
import { tracedAssertWorkspaceAvailable } from '../workspace/traced-workspace-availability';

let service: ConversationRuntimeService | null = null;

export function getConversationRuntimeService(
  getService: () => unknown,
): ConversationRuntimeService {
  if (!service) {
    const agentService = getService() as CanvasAgentService;
    service = new ConversationRuntimeService(
      (scope) => agentService.getAgentForScope(scope),
      (storeId, scope) => ({
        create: (sessionId, messages) => agentService.sessionMutations.createStoredConversation(scope, async () => {
          await new SessionStore(storeId, scope).createConversationById(sessionId, messages);
        }),
        loadMessages: async (sessionId) => (
          agentService.sessionMutations.readConversation(scope, sessionId)
        ),
        persist: (sessionId, messages) => (
          agentService.sessionMutations.replaceConversationMessages(scope, sessionId, messages)
        ),
      }),
      (scope, sessionId, operation) => (
        agentService.sessionMutations.runChat(scope, operation, sessionId)
      ),
      (scope) => agentService.activateScope(scope),
      tracedAssertWorkspaceAvailable,
    );
  }
  return service;
}

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

/**
 * Windows that receive a conversation's stream events: the window that sent
 * a turn, plus any window that attached to it later (renderer reload, another
 * window). Destroyed windows are pruned as events are sent.
 */
const turnSubscribers = new Map<string, Set<WebContents>>();

const subscribersFor = (scope: AgentScope, sessionId: string): Set<WebContents> => {
  const id = conversationKeyId(conversationKey(scope, sessionId));
  let subscribers = turnSubscribers.get(id);
  if (!subscribers) {
    subscribers = new Set();
    turnSubscribers.set(id, subscribers);
  }
  return subscribers;
};

const send = (subscribers: Set<WebContents>, channel: string, sessionId: string, data: unknown): void => {
  for (const subscriber of [...subscribers]) {
    if (subscriber.isDestroyed()) {
      subscribers.delete(subscriber);
      continue;
    }
    subscriber.send(`canvas-agent:${channel}:${sessionId}`, data);
  }
};

export interface ConversationRuntimeChatPayload {
  scope: AgentScope;
  sessionId: string;
  message: string;
  mentionedWorkspaceIds?: string[];
  requestContext?: AgentRequestContext;
  attachments?: ChatImageAttachment[];
  truncateAt?: number;
  trace?: ConversationSendInput['trace'];
}

/**
 * IPC surface for the conversation-runtime path. The renderer drives a
 * conversation by key (scope + sessionId) and receives the same per-session
 * stream events as the legacy protocol, so the existing renderer listeners
 * work unchanged while main owns per-conversation state.
 */
export function setupConversationRuntimeIpc(getService: () => CanvasAgentService): void {
  const ensure = (): ConversationRuntimeService => getConversationRuntimeService(getService);

  ipcMain.handle(
    'canvas-agent:conversation-chat',
    (
      event,
      payload: ConversationRuntimeChatPayload,
    ) => {
      const runtime = ensure();
      const { scope, sessionId, message, mentionedWorkspaceIds, requestContext, attachments, truncateAt } = payload;
      if (isPerfChatReplayRequest(message, process.env.PULSE_CANVAS_PERF === '1')) {
        void replayPerfChatStream(event.sender, sessionId);
        return { ok: true, sessionId };
      }
      const subscribers = subscribersFor(scope, sessionId);
      subscribers.add(event.sender);
      const completion = runtime.chat(scope, sessionId, message, {
        onText: (delta) => send(subscribers, 'text-delta', sessionId, delta),
        onToolCall: (data) => send(subscribers, 'tool-call', sessionId, data),
        onToolResult: (data) => send(subscribers, 'tool-result', sessionId, data),
        onToolInputStart: (data) => send(subscribers, 'tool-input-start', sessionId, data),
        onToolInputDelta: (data) => send(subscribers, 'tool-input-delta', sessionId, data),
        onToolInputEnd: (data) => send(subscribers, 'tool-input-end', sessionId, data),
        onClarificationRequest: (req) => send(subscribers, 'clarify-request', sessionId, req),
        onRoleTurnStart: (ev) => send(subscribers, 'role-turn-start', sessionId, ev),
        onRoleTurnEnd: (ev) => send(subscribers, 'role-turn-end', sessionId, ev),
      }, {
        mentionedWorkspaceIds,
        requestContext,
        attachments,
        truncateAt,
        trace: payload.trace
          && typeof payload.trace.runId === 'string'
          && /^[a-zA-Z0-9-]{1,100}$/.test(payload.trace.runId)
          && Number.isFinite(payload.trace.submittedAt)
          && payload.trace.submittedAt <= Date.now()
          ? payload.trace : undefined,
      });
      void completion.then(
        result => send(subscribers, 'chat-complete', sessionId, result),
        error => send(subscribers, 'chat-complete', sessionId, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return { ok: true, sessionId };
    },
  );

  // Synchronous on purpose: the snapshot and the subscription are taken in
  // one main-process task, and per-window IPC is ordered. Stream events the
  // renderer receives before this reply are already in the snapshot; events
  // after it are new.
  ipcMain.handle(
    'canvas-agent:conversation-attach',
    (event, payload: { scope: AgentScope; sessionId: string }) => {
      const snapshot = ensure().liveSnapshot(payload.scope, payload.sessionId);
      if (!snapshot) return { ok: true, running: false };
      subscribersFor(payload.scope, payload.sessionId).add(event.sender);
      return { ok: true, running: true, snapshot };
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
  turnSubscribers.clear();
  service?.disposeAll();
  service = null;
}
