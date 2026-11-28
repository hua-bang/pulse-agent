/**
 * Client for VPS daemon agent runs (`/v1/agent/chat`, `/v1/agent/runs/:id/events`).
 * A run lives on the daemon, not on the HTTP stream. This client follows one
 * run to its `complete` event: after a dropped or silent stream it resumes
 * from the last event id, and a `snapshot` event fills any gap the daemon no
 * longer buffers. Pure fetch code, shared by the desktop main process and the
 * web host.
 */

import type { AgentChatMessage, AgentChatToolCall } from '../agent-chat';
import type { ConversationKey, ConversationSnapshot } from '../conversation-runtime';

export interface VpsRunToolCall {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
}

export interface VpsRunToolResult {
  toolCallId: string;
  name: string;
  status: 'succeeded' | 'failed';
  result: string;
  error?: string;
}

export interface VpsRunHandlers {
  onText?: (delta: string) => void;
  onToolCall?: (call: VpsRunToolCall) => void;
  onToolResult?: (result: VpsRunToolResult) => void;
  /** The run waits behind other runs of the same conversation. */
  onQueued?: (position: number) => void;
  onStarted?: () => void;
  /** The daemon accepted the run (start response arrived, or a follow connected). */
  onAccepted?: () => void;
}

export interface VpsRunResult {
  ok: boolean;
  runId: string;
  stopped: boolean;
  response: string;
  error?: string;
  code?: string;
}

export interface VpsRunStartBody {
  workspaceId: string;
  sessionId: string;
  /** Client-chosen id, so a stream that drops before its first event can still resume. */
  runId: string;
  message: string;
  senderName?: string;
  clientId?: string;
  llm?: unknown;
}

export interface FollowVpsRunOptions {
  endpoint: string;
  token: string;
  /** Start a new run, or follow an existing one from `after`. */
  start: { kind: 'start'; body: VpsRunStartBody } | { kind: 'follow'; runId: string; after?: number };
  handlers?: VpsRunHandlers;
  /** Stops following (the run keeps going on the daemon). */
  signal?: AbortSignal;
  /** Re-resolves the endpoint before a reconnect (an SSH tunnel can move). */
  refreshEndpoint?: () => Promise<{ endpoint: string; token: string } | null>;
  fetchImpl?: typeof fetch;
  idleTimeoutMs?: number;
  /** Total reconnect budget without receiving any event. */
  reconnectWindowMs?: number;
}

/** Thrown when the daemon refuses to start the run (HTTP error before streaming). */
export class VpsRunStartError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'VpsRunStartError';
  }
}

const DEFAULT_IDLE_TIMEOUT_MS = 45_000;
const DEFAULT_RECONNECT_WINDOW_MS = 120_000;

interface StreamState {
  lastSeq: number;
  text: string;
  tools: Map<string, 'running' | 'succeeded' | 'failed'>;
  complete: VpsRunResult | null;
}

function parseBlock(block: string): { id?: number; event: string; data: string } | null {
  let event = 'message';
  let id: number | undefined;
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trim());
    else if (line.startsWith('id:')) {
      const parsed = Number(line.slice(3).trim());
      if (Number.isFinite(parsed)) id = parsed;
    }
  }
  return data.length > 0 ? { id, event, data: data.join('\n') } : null;
}

function toolResultOf(payload: Record<string, unknown>): VpsRunToolResult | null {
  if (typeof payload.toolCallId !== 'string') return null;
  return {
    toolCallId: payload.toolCallId,
    name: typeof payload.name === 'string' ? payload.name : 'unknown',
    status: payload.status === 'failed' ? 'failed' : 'succeeded',
    result: typeof payload.result === 'string' ? payload.result : '',
    ...(typeof payload.error === 'string' ? { error: payload.error } : {}),
  };
}

function completeOf(payload: Record<string, unknown>, runId: string, text: string): VpsRunResult {
  return {
    ok: Boolean(payload.ok),
    runId: typeof payload.runId === 'string' ? payload.runId : runId,
    stopped: Boolean(payload.stopped),
    response: typeof payload.response === 'string' ? payload.response : text,
    ...(typeof payload.error === 'string' ? { error: payload.error } : {}),
  };
}

/** Apply one event; snapshots only emit what this client has not seen yet. */
export function applyVpsRunEvent(
  state: StreamState,
  runId: string,
  event: string,
  payload: Record<string, unknown>,
  handlers: VpsRunHandlers = {},
): void {
  if (event === 'text_delta' && typeof payload.delta === 'string') {
    state.text += payload.delta;
    handlers.onText?.(payload.delta);
  } else if (event === 'tool_call' && typeof payload.toolCallId === 'string') {
    if (state.tools.has(payload.toolCallId)) return;
    state.tools.set(payload.toolCallId, 'running');
    handlers.onToolCall?.({
      toolCallId: payload.toolCallId,
      name: typeof payload.name === 'string' ? payload.name : 'unknown',
      args: payload.args && typeof payload.args === 'object' ? payload.args as Record<string, unknown> : {},
    });
  } else if (event === 'tool_result') {
    const result = toolResultOf(payload);
    if (!result || (state.tools.get(result.toolCallId) ?? 'running') !== 'running') return;
    state.tools.set(result.toolCallId, result.status);
    handlers.onToolResult?.(result);
  } else if (event === 'queued') {
    handlers.onQueued?.(typeof payload.position === 'number' ? payload.position : 1);
  } else if (event === 'started') {
    handlers.onStarted?.();
  } else if (event === 'complete') {
    state.complete = completeOf(payload, runId, state.text);
  } else if (event === 'snapshot') {
    const text = typeof payload.text === 'string' ? payload.text : '';
    // Text only grows, so the missing part is the suffix past what we have.
    if (text.length > state.text.length && text.startsWith(state.text)) {
      const delta = text.slice(state.text.length);
      state.text = text;
      handlers.onText?.(delta);
    }
    const tools = Array.isArray(payload.tools) ? payload.tools as Array<Record<string, unknown>> : [];
    for (const tool of tools) {
      applyVpsRunEvent(state, runId, 'tool_call', tool, handlers);
      if (tool.status === 'succeeded' || tool.status === 'failed') {
        applyVpsRunEvent(state, runId, 'tool_result', tool, handlers);
      }
    }
    if (payload.status === 'running') handlers.onStarted?.();
    if (payload.complete && typeof payload.complete === 'object') {
      state.complete = completeOf(payload.complete as Record<string, unknown>, runId, state.text);
    }
  }
}

/** Follow a run to completion, reconnecting as needed. */
export async function followVpsRun(options: FollowVpsRunOptions): Promise<VpsRunResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const reconnectWindowMs = options.reconnectWindowMs ?? DEFAULT_RECONNECT_WINDOW_MS;
  let { endpoint, token } = options;
  const runId = options.start.kind === 'start' ? options.start.body.runId : options.start.runId;
  const state: StreamState = {
    lastSeq: options.start.kind === 'follow' ? options.start.after ?? 0 : 0,
    text: '',
    tools: new Map(),
    complete: null,
  };
  // Until the daemon confirms the run, a retry re-sends the start; the daemon
  // treats a known runId as a re-attach, so the run never starts twice.
  let confirmed = options.start.kind === 'follow';
  let first = true; // onAccepted fires once
  let lastProgressAt = Date.now();
  let delayMs = 500;
  const detached = (): VpsRunResult => ({ ok: false, runId, stopped: true, response: state.text, error: 'Detached' });

  while (!state.complete) {
    if (options.signal?.aborted) return detached();
    const controller = new AbortController();
    const onOuterAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onOuterAbort, { once: true });
    let idle: ReturnType<typeof setTimeout> | null = null;
    const armIdle = () => {
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => controller.abort(), idleTimeoutMs);
      (idle as { unref?: () => void }).unref?.();
    };
    try {
      armIdle();
      const startNew = !confirmed;
      const res = startNew
        ? await fetchImpl(`${endpoint}/v1/agent/chat`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify(options.start.kind === 'start' ? options.start.body : {}),
          signal: controller.signal,
        })
        : await fetchImpl(
          `${endpoint}/v1/agent/runs/${encodeURIComponent(runId)}/events?after=${state.lastSeq}`,
          { headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' }, signal: controller.signal },
        );
      if (startNew && !res.ok) {
        const body = await res.json().catch(() => ({})) as { code?: string; message?: string; error?: string };
        throw new VpsRunStartError(
          body.message || body.error || `VPS Agent returned HTTP ${res.status}`,
          res.status,
          body.code,
        );
      }
      if (res.status === 404) {
        return { ok: false, runId, stopped: false, response: state.text, code: 'run_not_found', error: 'The VPS run ended or expired before it could be resumed.' };
      }
      if (!res.ok || !res.body) throw new Error(`VPS run stream HTTP ${res.status}`);
      confirmed = true;
      if (first) {
        first = false;
        options.handlers?.onAccepted?.();
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (!state.complete) {
        const { done, value } = await reader.read();
        if (done) break;
        armIdle();
        buffer += decoder.decode(value, { stream: true });
        let sep = buffer.indexOf('\n\n');
        while (sep !== -1) {
          const parsed = parseBlock(buffer.slice(0, sep));
          buffer = buffer.slice(sep + 2);
          sep = buffer.indexOf('\n\n');
          if (!parsed) continue;
          if (parsed.id !== undefined) {
            if (parsed.id <= state.lastSeq && parsed.event !== 'snapshot') continue;
            state.lastSeq = Math.max(state.lastSeq, parsed.id);
          }
          let payload: Record<string, unknown>;
          try {
            payload = JSON.parse(parsed.data) as Record<string, unknown>;
          } catch {
            continue;
          }
          lastProgressAt = Date.now();
          delayMs = 500;
          applyVpsRunEvent(state, runId, parsed.event, payload, options.handlers);
        }
      }
      reader.cancel().catch(() => undefined);
    } catch (err) {
      if (err instanceof VpsRunStartError) throw err;
      // Network drop, tunnel restart, or idle watchdog: resume below.
    } finally {
      if (idle) clearTimeout(idle);
      options.signal?.removeEventListener('abort', onOuterAbort);
    }
    if (state.complete) break;
    if (options.signal?.aborted) return detached();
    if (Date.now() - lastProgressAt > reconnectWindowMs) {
      return { ok: false, runId, stopped: false, response: state.text, code: 'vps_unreachable', error: 'Lost the connection to the VPS run.' };
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    delayMs = Math.min(delayMs * 2, 5_000);
    const next = await options.refreshEndpoint?.().catch(() => null);
    if (next) ({ endpoint, token } = next);
  }
  return state.complete!;
}

/** The daemon's view of a conversation's running run, for attach. */
export interface VpsActiveRun {
  runId: string;
  seq: number;
  prompt: string;
  senderName: string;
  clientId: string;
  status: 'queued' | 'running' | 'done';
  text: string;
  tools: Array<{ toolCallId: string; name: string; args?: Record<string, unknown>; status: 'running' | 'succeeded' | 'failed'; result?: string; error?: string }>;
}

export async function fetchVpsActiveRun(
  endpoint: string,
  token: string,
  workspaceId: string,
  sessionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VpsActiveRun | null> {
  const qs = `workspaceId=${encodeURIComponent(workspaceId)}&sessionId=${encodeURIComponent(sessionId)}`;
  const res = await fetchImpl(`${endpoint}/v1/agent/runs?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null) as { active?: VpsActiveRun | null } | null;
  return body?.active && body.active.status === 'running' ? body.active : null;
}

export async function abortVpsRun(
  endpoint: string,
  token: string,
  body: { workspaceId: string; sessionId: string; runId?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const res = await fetchImpl(`${endpoint}/v1/agent/abort`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({})) as { aborted?: boolean };
  return Boolean(json.aborted);
}

/**
 * Conversation snapshot for a surface attaching to a daemon run: durable
 * messages plus the run's reply so far as the draft. `after` is the event id
 * the snapshot covers; follow the run from there.
 */
export function conversationSnapshotFromVpsRun(
  key: ConversationKey,
  messages: AgentChatMessage[],
  run: VpsActiveRun,
): { snapshot: ConversationSnapshot; after: number } {
  // The daemon persists the user turn when the run starts; older daemons do not.
  const last = messages[messages.length - 1];
  const withPrompt = last?.role === 'user' && last.content === run.prompt
    ? messages
    : [...messages, { role: 'user' as const, content: run.prompt, senderName: run.senderName, timestamp: Date.now() }];
  const streamingTools: AgentChatToolCall[] = run.tools.map((tool, index) => ({
    id: index + 1,
    name: tool.name,
    args: tool.args ?? {},
    toolCallId: tool.toolCallId,
    status: tool.status,
    ...(tool.result !== undefined ? { result: tool.result } : {}),
    ...(tool.error !== undefined ? { error: tool.error } : {}),
  }));
  return {
    after: run.seq,
    snapshot: {
      key,
      status: 'running',
      messages: withPrompt,
      streamingTools,
      draft: { role: 'assistant', content: run.text, timestamp: Date.now() },
      clarification: null,
      error: null,
      runId: run.runId,
      sequence: run.seq,
    },
  };
}
