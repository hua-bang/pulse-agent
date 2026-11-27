import type { CanvasWorkspaceApi } from '../../../../shared/api/workspace-api';
import type { AgentScope } from '../../../../shared/agent-chat';
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
): Partial<AgentApi> {
  const textListeners = createListenerRegistry<TextDeltaCb>();
  const toolCallListeners = createListenerRegistry<ToolCallCb>();
  const toolResultListeners = createListenerRegistry<ToolResultCb>();
  const completeListeners = createListenerRegistry<ChatCompleteCb>();
  const activeControllers = new Map<string, AbortController>();

  const authHeaders = () => ({
    Authorization: `Bearer ${session.token}`,
    'Content-Type': 'application/json',
  });

  async function pumpSse(
    res: Response,
    sessionId: string,
    runId: string | undefined,
    controller: AbortController,
  ): Promise<void> {
    if (!res.body) {
      completeListeners.emit(sessionId, (cb) =>
        cb({ ok: false, error: 'Empty agent response stream', runId }),
      );
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let completed = false;
    let accumulated = '';

    const handleEvent = (eventName: string, rawData: string) => {
      let payload: Record<string, any>;
      try {
        payload = JSON.parse(rawData) as Record<string, any>;
      } catch {
        return;
      }
      if (eventName === 'text_delta' && typeof payload.delta === 'string') {
        accumulated += payload.delta;
        textListeners.emit(sessionId, (cb) => cb(payload.delta));
      } else if (eventName === 'tool_call' && typeof payload.name === 'string') {
        toolCallListeners.emit(sessionId, (cb) =>
          cb({
            name: payload.name,
            args: payload.args ?? {},
            ...(typeof payload.toolCallId === 'string' ? { toolCallId: payload.toolCallId } : {}),
          }),
        );
      } else if (eventName === 'tool_result' && typeof payload.name === 'string') {
        const status = payload.status === 'failed' ? 'failed' : 'succeeded';
        toolResultListeners.emit(sessionId, (cb) =>
          cb({
            name: payload.name,
            result: typeof payload.result === 'string' ? payload.result : '',
            status,
            ...(typeof payload.toolCallId === 'string' ? { toolCallId: payload.toolCallId } : {}),
            ...(typeof payload.error === 'string' ? { error: payload.error } : {}),
          }),
        );
      } else if (eventName === 'complete') {
        completed = true;
        completeListeners.emit(sessionId, (cb) =>
          cb({
            ok: Boolean(payload.ok),
            response: typeof payload.response === 'string' ? payload.response : accumulated,
            stopped: Boolean(payload.stopped),
            runId: typeof payload.runId === 'string' ? payload.runId : runId,
            ...(typeof payload.error === 'string' ? { error: payload.error } : {}),
          }),
        );
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep = buffer.indexOf('\n\n');
        while (sep !== -1) {
          const block = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          let eventName = 'message';
          const dataLines: string[] = [];
          for (const line of block.split(/\r?\n/)) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
          }
          if (dataLines.length > 0) handleEvent(eventName, dataLines.join('\n'));
          sep = buffer.indexOf('\n\n');
        }
      }
      if (!completed) {
        completeListeners.emit(sessionId, (cb) =>
          cb({
            ok: !controller.signal.aborted,
            stopped: controller.signal.aborted,
            response: accumulated,
            runId,
          }),
        );
      }
    } catch (err) {
      if (!completed) {
        const stopped = controller.signal.aborted;
        completeListeners.emit(sessionId, (cb) =>
          cb({
            ok: false,
            stopped,
            response: accumulated,
            runId,
            error: stopped ? 'Aborted' : err instanceof Error ? err.message : String(err),
          }),
        );
      }
    } finally {
      reader.releaseLock();
      if (activeControllers.get(sessionId) === controller) {
        activeControllers.delete(sessionId);
      }
    }
  }

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
      return { ok: true, sessionId };
    },
    conversationChat: async (scope, sessionId, message, _mentioned, _ctx, _attachments, _truncateAt, trace) => {
      const workspaceId = session.workspaceId || workspaceIdFromScope(scope, getActiveWorkspaceId());
      if (!workspaceId) {
        return { ok: false, error: 'No active workspace selected.' };
      }
      const prev = activeControllers.get(sessionId);
      if (prev) prev.abort();
      const controller = new AbortController();
      activeControllers.set(sessionId, controller);

      const llm = readStoredWebLlmConfig();
      try {
        const res = await fetch(`${session.endpoint}/v1/agent/chat`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            workspaceId,
            sessionId,
            message,
            senderName: session.senderName,
            clientId: session.clientId,
            ...(trace?.runId ? { runId: trace.runId } : {}),
            ...(llm ? { llm } : {}),
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          activeControllers.delete(sessionId);
          const body = (await res.json().catch(() => ({}))) as {
            code?: string;
            message?: string;
            error?: string;
          };
          if (body.code === 'agent_not_configured') {
            openWebModelSettingsModal(session);
          }
          return {
            ok: false,
            error: body.message || body.error || `VPS Agent returned HTTP ${res.status}`,
          };
        }
        void pumpSse(res, sessionId, trace?.runId, controller);
        return { ok: true, sessionId };
      } catch (err) {
        activeControllers.delete(sessionId);
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    conversationAbort: async (scope, sessionId) => {
      const active = activeControllers.get(sessionId);
      if (active) active.abort();
      const workspaceId = session.workspaceId || workspaceIdFromScope(scope, getActiveWorkspaceId());
      try {
        await fetch(`${session.endpoint}/v1/agent/abort`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ workspaceId, sessionId }),
        });
      } catch {
        // Best effort remote abort.
      }
      return { ok: true };
    },
    onTextDelta: (sessionId, cb) => textListeners.subscribe(sessionId, cb),
    onToolCall: (sessionId, cb) => toolCallListeners.subscribe(sessionId, cb),
    onToolResult: (sessionId, cb) => toolResultListeners.subscribe(sessionId, cb),
    onChatComplete: (sessionId, cb) => completeListeners.subscribe(sessionId, cb),
  };
}
