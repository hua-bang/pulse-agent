import type { CanvasWorkspaceApi } from '../../../../shared/api/workspace-api';
import type { AgentChatMessage, AgentScope } from '../../../../shared/agent-chat';
import { conversationKey } from '../../../../shared/conversation-runtime';
import {
  abortVpsRun,
  conversationSnapshotFromVpsRun,
  fetchVpsActiveRun,
  followVpsRun,
  VpsRunStartError,
  type FollowVpsRunOptions,
  type VpsRunHandlers,
  type VpsRunResult,
} from '../../../../shared/vps-agent/run-stream';
import { openWebModelSettingsModal, readStoredWebLlmConfig } from './modelSettings';
import type { WebHostAuthSession } from './types';

type AgentApi = CanvasWorkspaceApi['agent'];
type TextDeltaCb = Parameters<AgentApi['onTextDelta']>[1];
type ToolCallCb = Parameters<AgentApi['onToolCall']>[1];
type ToolResultCb = Parameters<AgentApi['onToolResult']>[1];
type ChatCompleteCb = Parameters<AgentApi['onChatComplete']>[1];

function workspaceIdFromScope(scope: AgentScope, fallback?: string): string {
  if (scope && typeof scope === 'object' && scope.kind === 'workspace' && scope.workspaceId) {
    return scope.workspaceId;
  }
  return fallback || '';
}

function createListenerRegistry<T>() {
  const bySession = new Map<string, Set<T>>();
  return {
    subscribe(sessionId: string, cb: T): () => void {
      let set = bySession.get(sessionId);
      if (!set) {
        set = new Set<T>();
        bySession.set(sessionId, set);
      }
      set.add(cb);
      return () => {
        set?.delete(cb);
        if (set && set.size === 0) bySession.delete(sessionId);
      };
    },
    emit(sessionId: string, invoke: (cb: T) => void): void {
      const set = bySession.get(sessionId);
      if (!set) return;
      for (const cb of [...set]) {
        try {
          invoke(cb);
        } catch {
          // Isolate subscriber errors.
        }
      }
    },
  };
}

export function createWebAgentRuntime(
  session: WebHostAuthSession,
  getActiveWorkspaceId: () => string | undefined,
  loadMessages: (workspaceId: string, sessionId: string) => Promise<AgentChatMessage[]> = async () => [],
): Partial<AgentApi> {
  const textListeners = createListenerRegistry<TextDeltaCb>();
  const toolCallListeners = createListenerRegistry<ToolCallCb>();
  const toolResultListeners = createListenerRegistry<ToolResultCb>();
  const completeListeners = createListenerRegistry<ChatCompleteCb>();
  /** Runs this tab follows, by session. Detaching stops following, never the run. */
  const following = new Map<string, { runId: string; detach: AbortController }>();

  const workspaceFor = (scope: AgentScope) => session.workspaceId || workspaceIdFromScope(scope, getActiveWorkspaceId());

  const handlersFor = (sessionId: string, extra: VpsRunHandlers = {}): VpsRunHandlers => ({
    ...extra,
    onText: (delta) => textListeners.emit(sessionId, (cb) => cb(delta)),
    onToolCall: (call) => toolCallListeners.emit(sessionId, (cb) => cb({
      name: call.name,
      args: call.args,
      toolCallId: call.toolCallId,
    })),
    onToolResult: (result) => toolResultListeners.emit(sessionId, (cb) => cb({
      name: result.name,
      result: result.result,
      status: result.status,
      toolCallId: result.toolCallId,
      ...(result.error ? { error: result.error } : {}),
    })),
  });

  const emitComplete = (sessionId: string, result: VpsRunResult) => {
    completeListeners.emit(sessionId, (cb) => cb({
      ok: result.ok,
      response: result.response,
      stopped: result.stopped,
      runId: result.runId,
      ...(result.error && !result.stopped ? { error: result.error } : {}),
    }));
  };

  /** Follow a run to the end and report it; replaces any run this tab followed for the session. */
  const follow = (sessionId: string, start: FollowVpsRunOptions['start'], extra?: VpsRunHandlers) => {
    following.get(sessionId)?.detach.abort();
    const detach = new AbortController();
    const runId = start.kind === 'start' ? start.body.runId : start.runId;
    following.set(sessionId, { runId, detach });
    const run = followVpsRun({
      endpoint: session.endpoint,
      token: session.token,
      start,
      signal: detach.signal,
      handlers: handlersFor(sessionId, extra),
    });
    void run.then(
      (result) => {
        // A replaced follower must not complete the newer turn.
        if (following.get(sessionId)?.runId !== runId) return;
        following.delete(sessionId);
        emitComplete(sessionId, result);
      },
      () => undefined,
    ).finally(() => {
      if (following.get(sessionId)?.runId === runId) following.delete(sessionId);
    });
    return run;
  };

  return {
    listSkills: async () => {
      try {
        const res = await fetch(`${session.endpoint}/v1/agent/skills`, {
          headers: { Authorization: `Bearer ${session.token}` },
        });
        if (!res.ok) return { ok: true, skills: [] };
        const body = (await res.json()) as {
          ok?: boolean;
          skills?: Array<{ name: string; description: string; source?: string }>;
        };
        const skills = Array.isArray(body.skills)
          ? body.skills.map((s) => ({
              name: s.name,
              description: s.description,
              source: s.source === 'user' ? 'global' : 'workspace',
            }))
          : [];
        return { ok: true, skills };
      } catch {
        return { ok: true, skills: [] };
      }
    },
    newSession: async () => {
      const sessionId = `vps-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      return { ok: true, sessionId, activeSessionId: sessionId };
    },
    conversationChat: async (scope, sessionId, message, _mentioned, _ctx, _attachments, _truncateAt, trace) => {
      const workspaceId = workspaceFor(scope);
      if (!workspaceId) {
        return { ok: false, error: 'No active workspace selected.' };
      }
      const llm = readStoredWebLlmConfig();
      const runId = trace?.runId || crypto.randomUUID();
      // Resolve once the daemon accepts (or refuses) the run; the reply streams after.
      return await new Promise((resolve) => {
        let settled = false;
        const settle = (value: { ok: boolean; sessionId?: string; error?: string }) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        follow(sessionId, {
          kind: 'start',
          body: {
            workspaceId,
            sessionId,
            runId,
            message,
            ...(session.senderName ? { senderName: session.senderName } : {}),
            ...(session.clientId ? { clientId: session.clientId } : {}),
            ...(llm ? { llm } : {}),
          },
        }, {
          onAccepted: () => settle({ ok: true, sessionId }),
        }).then(
          (result) => settle(result.ok || result.stopped ? { ok: true, sessionId } : { ok: false, error: result.error }),
          (err: unknown) => {
            if (err instanceof VpsRunStartError && err.code === 'agent_not_configured') {
              openWebModelSettingsModal(session);
            }
            if (following.get(sessionId)?.runId === runId) following.delete(sessionId);
            settle({ ok: false, error: err instanceof Error ? err.message : String(err) });
          },
        );
      });
    },
    conversationAttach: async (scope, sessionId) => {
      const workspaceId = workspaceFor(scope);
      if (!workspaceId || following.has(sessionId)) return { ok: true, running: false };
      try {
        const active = await fetchVpsActiveRun(session.endpoint, session.token, workspaceId, sessionId);
        if (!active) return { ok: true, running: false };
        const messages = await loadMessages(workspaceId, sessionId);
        const { snapshot, after } = conversationSnapshotFromVpsRun(conversationKey(scope, sessionId), messages, active);
        void follow(sessionId, { kind: 'follow', runId: active.runId, after });
        return { ok: true, running: true, snapshot };
      } catch {
        return { ok: true, running: false };
      }
    },
    conversationAbort: async (scope, sessionId) => {
      const workspaceId = workspaceFor(scope);
      const active = following.get(sessionId);
      try {
        // Keep following: the stopped reply arrives as the run's complete event.
        await abortVpsRun(session.endpoint, session.token, {
          workspaceId,
          sessionId,
          ...(active ? { runId: active.runId } : {}),
        });
      } catch {
        // The VPS is unreachable; stop waiting for it.
        active?.detach.abort();
      }
      return { ok: true };
    },
    onTextDelta: (sessionId, cb) => textListeners.subscribe(sessionId, cb),
    onToolCall: (sessionId, cb) => toolCallListeners.subscribe(sessionId, cb),
    onToolResult: (sessionId, cb) => toolResultListeners.subscribe(sessionId, cb),
    onChatComplete: (sessionId, cb) => completeListeners.subscribe(sessionId, cb),
  };
}
