import { randomUUID } from 'node:crypto';
import type { AgentChatMessage } from '../../../shared/agent-chat';
import type { ConversationKey, ConversationSnapshot } from '../../../shared/conversation-runtime';
import {
  abortVpsRun,
  conversationSnapshotFromVpsRun,
  fetchVpsActiveRun,
  followVpsRun,
  VpsRunStartError,
  type VpsRunHandlers,
  type VpsRunResult,
} from '../../../shared/vps-agent/run-stream';
import type { ResolvedRemoteTarget } from '../../remote/client';
import type { TurnRunnerContext, TurnRunnerResult } from './conversation-runtime';

export interface VpsRunnerDeps {
  /** Re-resolved per turn and per reconnect: an SSH tunnel can move. */
  resolveTarget: () => Promise<ResolvedRemoteTarget | null>;
  clientId: string;
  senderName: () => string | undefined;
  fetchImpl?: typeof fetch;
}

/** Runtime-built prompt prefix for shared workspaces; the daemon records the sender itself. */
const stripSenderPrefix = (message: string, senderName: string | undefined) => {
  const prefix = senderName ? `[${senderName}]: ` : '';
  return prefix && message.startsWith(prefix) ? message.slice(prefix.length) : message;
};

const refreshOf = (deps: VpsRunnerDeps) => async () => {
  const target = await deps.resolveTarget();
  return target ? { endpoint: target.endpoint, token: target.token } : null;
};

/**
 * Wire the follower to the stop button. Abort asks the daemon to stop the
 * run and keeps following, so the stopped reply still arrives; if the daemon
 * cannot be reached, stop following instead.
 */
function bindAbort(
  signal: AbortSignal,
  deps: VpsRunnerDeps,
  run: { workspaceId: string; sessionId: string; runId: string },
  detach: AbortController,
): void {
  const onAbort = () => {
    void (async () => {
      const target = await deps.resolveTarget().catch(() => null);
      if (!target) throw new Error('VPS unreachable');
      await abortVpsRun(target.endpoint, target.token, run, deps.fetchImpl);
    })().catch(() => detach.abort());
  };
  if (signal.aborted) onAbort();
  else signal.addEventListener('abort', onAbort, { once: true });
}

const handlersOf = (ctx: TurnRunnerContext): VpsRunHandlers => ({
  onText: (delta) => ctx.onText?.(delta),
  onToolCall: (call) => ctx.onToolCall?.({ name: call.name, args: call.args, toolCallId: call.toolCallId }),
  onToolResult: (result) => ctx.onToolResult?.({
    name: result.name,
    result: result.result,
    toolCallId: result.toolCallId,
    status: result.status,
    ...(result.error ? { error: result.error } : {}),
  }),
});

function toTurnResult(result: VpsRunResult): TurnRunnerResult {
  if (result.stopped) return { response: result.response, runId: result.runId, stopped: true };
  if (!result.ok) {
    return { response: result.response, runId: result.runId, code: result.code, error: result.error ?? 'VPS run failed' };
  }
  return { response: result.response, runId: result.runId };
}

/**
 * Runner seam for workspaces whose chat runs on the VPS daemon. The daemon
 * owns the run, its queue, and persistence (pair with `persistence: 'runner'`);
 * the desktop follows the run's event log and survives stream drops.
 * Local-only inputs (attachments, MCP app context) are not sent.
 */
export function createVpsConversationRunner(
  deps: VpsRunnerDeps,
): (ctx: TurnRunnerContext) => Promise<TurnRunnerResult> {
  return async (ctx) => {
    const target = await deps.resolveTarget();
    if (!target) return { response: '', error: 'The VPS for this workspace is not reachable.' };
    const sessionId = ctx.expectedSessionId;
    if (!sessionId) return { response: '', error: 'A VPS chat turn needs a conversation id.' };
    const senderName = deps.senderName();
    const runId = randomUUID();
    const detach = new AbortController();
    bindAbort(ctx.signal, deps, { workspaceId: target.remoteWorkspaceId, sessionId, runId }, detach);
    try {
      const result = await followVpsRun({
        endpoint: target.endpoint,
        token: target.token,
        start: {
          kind: 'start',
          body: {
            workspaceId: target.remoteWorkspaceId,
            sessionId,
            runId,
            message: stripSenderPrefix(ctx.message, senderName),
            clientId: deps.clientId,
            ...(senderName ? { senderName } : {}),
          },
        },
        signal: detach.signal,
        refreshEndpoint: refreshOf(deps),
        handlers: handlersOf(ctx),
        fetchImpl: deps.fetchImpl,
      });
      return toTurnResult(result);
    } catch (err) {
      const code = err instanceof VpsRunStartError ? err.code : undefined;
      return { response: '', ...(code ? { code } : {}), error: err instanceof Error ? err.message : String(err) };
    }
  };
}

export interface RemoteRunAttachment {
  snapshot: ConversationSnapshot;
  /** Resolves when the run completes (or following stops). */
  done: Promise<VpsRunResult>;
}

/**
 * Attach to a run another member (or an earlier desktop session) started on
 * the daemon. Returns null when the conversation has no running run.
 */
export async function attachRemoteRun(
  deps: VpsRunnerDeps,
  key: ConversationKey,
  loadMessages: () => Promise<AgentChatMessage[]>,
  handlers: VpsRunHandlers,
  signal?: AbortSignal,
): Promise<RemoteRunAttachment | null> {
  const target = await deps.resolveTarget();
  if (!target) return null;
  const active = await fetchVpsActiveRun(
    target.endpoint, target.token, target.remoteWorkspaceId, key.sessionId, deps.fetchImpl,
  ).catch(() => null);
  if (!active) return null;
  const { snapshot, after } = conversationSnapshotFromVpsRun(key, await loadMessages(), active);
  const done = followVpsRun({
    endpoint: target.endpoint,
    token: target.token,
    start: { kind: 'follow', runId: active.runId, after },
    signal,
    refreshEndpoint: refreshOf(deps),
    handlers,
    fetchImpl: deps.fetchImpl,
  });
  return { snapshot, done };
}

/** Ask the daemon to stop a conversation's running run. */
export async function abortRemoteRun(deps: VpsRunnerDeps, sessionId: string, runId?: string): Promise<boolean> {
  const target = await deps.resolveTarget().catch(() => null);
  if (!target) return false;
  return await abortVpsRun(target.endpoint, target.token, {
    workspaceId: target.remoteWorkspaceId,
    sessionId,
    ...(runId ? { runId } : {}),
  }, deps.fetchImpl).catch(() => false);
}

/**
 * Runner deps when a workspace's chat runs on its VPS daemon, else null.
 * With the default `chatRuntime`, the daemon must have a model configured;
 * otherwise the desktop agent keeps running turns. An explicit
 * `chatRuntime: 'vps'` always uses the daemon.
 */
export async function resolveVpsRunnerDeps(
  workspaceId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VpsRunnerDeps | null> {
  const [{ resolveVpsChatTarget, setVpsChatActive }, config] = await Promise.all([
    import('../../remote/client'),
    import('../../remote/config'),
  ]);
  const target = await resolveVpsChatTarget(workspaceId).catch(() => null);
  if (target && config.getRemoteWorkspaceConfig(workspaceId)?.chatRuntime !== 'vps') {
    const status = await fetchImpl(`${target.endpoint}/v1/agent/status`, {
      headers: { Authorization: `Bearer ${target.token}` },
      signal: AbortSignal.timeout(5_000),
    }).then(res => res.json() as Promise<{ configured?: boolean }>).catch(() => null);
    if (!status?.configured) {
      setVpsChatActive(workspaceId, false);
      return null;
    }
  }
  setVpsChatActive(workspaceId, Boolean(target));
  if (!target) return null;
  return {
    resolveTarget: () => resolveVpsChatTarget(workspaceId),
    clientId: config.REMOTE_PROCESS_CLIENT_ID,
    senderName: () => config.resolveRemoteWorkspaceSenderName(workspaceId),
    fetchImpl,
  };
}
