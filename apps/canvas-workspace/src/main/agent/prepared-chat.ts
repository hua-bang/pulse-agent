import { randomUUID } from 'crypto';
import type { WebContents } from 'electron';

import type { AgentRequestContext, AgentScope } from './types';
import type { CanvasAgentService } from './service';
import type { ResolvedCanvasModel } from './model/config';
import { isPerfChatReplayRequest, replayPerfChatStream } from './perf-chat-replay';
import { GLOBAL_CHAT_SESSION_STORE_ID, SessionStore } from './session-store';

export interface PreparedChatPayload {
  message: string;
  mentionedWorkspaceIds?: string[];
  requestContext?: AgentRequestContext;
  attachments?: Array<{
    id: string;
    path: string;
    fileName?: string;
    mimeType?: string;
    sizeBytes?: number;
  }>;
}

export interface PreparedChat {
  sessionId: string;
  sender: WebContents;
  scope: AgentScope;
  payload: PreparedChatPayload;
}

export interface PreparedChatModelResolution {
  modelProvider: string;
  modelId: string;
  modelLabel: string;
}

interface PendingPreparedChat extends PreparedChat {
  expires: ReturnType<typeof setTimeout>;
  onExpire?: (turn: PreparedChat) => void;
}

/**
 * One-shot prepare → subscribe → start registry. A prepared turn is bound to
 * the renderer WebContents that created it and expires if the renderer never
 * starts it (for example because the page unmounted between the two calls).
 */
export class PreparedChatRegistry {
  private readonly pending = new Map<string, PendingPreparedChat>();

  constructor(private readonly ttlMs = 30_000) {}

  prepare(
    sender: WebContents,
    scope: AgentScope,
    payload: PreparedChatPayload,
    onExpire?: (turn: PreparedChat) => void,
  ): PreparedChat {
    const sessionId = randomUUID();
    const prepared: PreparedChat = { sessionId, sender, scope, payload };
    const expires = setTimeout(() => {
      const pending = this.pending.get(sessionId);
      if (!pending) return;
      this.pending.delete(sessionId);
      pending.onExpire?.(prepared);
    }, this.ttlMs);
    expires.unref?.();
    this.pending.set(sessionId, { ...prepared, expires, onExpire });
    return prepared;
  }

  take(sessionId: string, sender: WebContents): PreparedChat | null {
    const prepared = this.pending.get(sessionId);
    if (!prepared || prepared.sender.id !== sender.id) return null;
    clearTimeout(prepared.expires);
    this.pending.delete(sessionId);
    const { expires: _expires, ...turn } = prepared;
    return turn;
  }

  discard(sessionId: string, sender?: WebContents): boolean {
    const pending = this.pending.get(sessionId);
    if (!pending || (sender && pending.sender.id !== sender.id)) return false;
    clearTimeout(pending.expires);
    this.pending.delete(sessionId);
    const { expires: _expires, onExpire: _onExpire, ...turn } = pending;
    pending.onExpire?.(turn);
    return true;
  }

  clear(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.expires);
      const { expires: _expires, onExpire: _onExpire, ...turn } = pending;
      pending.onExpire?.(turn);
    }
    this.pending.clear();
  }
}

const send = (turn: PreparedChat, channel: string, data: unknown): void => {
  if (!turn.sender.isDestroyed()) {
    turn.sender.send(`canvas-agent:${channel}:${turn.sessionId}`, data);
  }
};

export function freezePreparedChatModel(
  turn: PreparedChat,
  modelConfig: ResolvedCanvasModel,
): PreparedChatModelResolution {
  const resolution = {
    modelProvider: modelConfig.providerId ?? modelConfig.providerType,
    modelId: modelConfig.model,
    modelLabel: modelConfig.modelLabel,
  };
  const snapshot = turn.payload.requestContext?.contextSnapshot;
  if (snapshot) Object.assign(snapshot, resolution);
  return resolution;
}

async function persistPerfReplay(turn: PreparedChat, content: string): Promise<void> {
  const { scope, payload, sessionId } = turn;
  const storeId = scope.kind === 'workspace'
    ? scope.workspaceId
    : scope.kind === 'scheduled'
      ? `__scheduled__-${scope.taskId}`
      : GLOBAL_CHAT_SESSION_STORE_ID;
  const store = new SessionStore(storeId, scope);
  await store.startSession();
  const timestamp = Date.now();
  store.setMessages([
    { role: 'user', content: payload.message, timestamp },
    {
      role: 'assistant',
      content,
      timestamp,
      runId: `perf-replay-${sessionId}`,
    },
  ]);
  await store.archiveSession();
}

/**
 * Starts only after the renderer has installed all run-scoped listeners.
 * Completion is fire-and-forget and always clears the caller's in-flight map.
 */
export function startPreparedChat(
  service: CanvasAgentService,
  turn: PreparedChat,
  abortSignal: AbortSignal,
  onSettled: () => void,
  modelConfig?: ResolvedCanvasModel,
): void {
  if (isPerfChatReplayRequest(turn.payload.message, process.env.PULSE_CANVAS_PERF === '1')) {
    void replayPerfChatStream(turn.sender, turn.sessionId, {
      onComplete: content => persistPerfReplay(turn, content),
    }).finally(onSettled);
    return;
  }

  const { payload, scope } = turn;
  void (async () => {
    try {
      const result = await service.chatWithScope(
        scope,
        payload.message,
        delta => send(turn, 'text-delta', delta),
        toolCall => send(turn, 'tool-call', toolCall),
        toolResult => send(turn, 'tool-result', toolResult),
        payload.mentionedWorkspaceIds,
        request => send(turn, 'clarify-request', request),
        payload.requestContext,
        payload.attachments,
        data => send(turn, 'tool-input-start', data),
        data => send(turn, 'tool-input-delta', data),
        data => send(turn, 'tool-input-end', data),
        event => send(turn, 'role-turn-start', event),
        event => send(turn, 'role-turn-end', event),
        abortSignal,
        modelConfig,
        turn.sessionId,
      );
      send(turn, 'chat-complete', result);
    } catch (error) {
      send(turn, 'chat-complete', { ok: false, error: String(error) });
    } finally {
      onSettled();
    }
  })();
}
