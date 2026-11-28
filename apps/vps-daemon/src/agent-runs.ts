import type { IncomingMessage, ServerResponse } from 'node:http';
import { writeSseFrame } from './auth.js';

/** Events kept per run for replay; a resume beyond this gets a snapshot. */
export const MAX_RUN_EVENTS = 4_000;
/** How long a finished run stays resumable. */
export const FINISHED_RUN_RETENTION_MS = 10 * 60_000;
const MAX_QUEUE_PER_SESSION = 50;
const KEEPALIVE_MS = 15_000;

export interface AgentRunEvent {
  seq: number;
  event: string;
  data: Record<string, unknown>;
}

export interface AgentRunTool {
  toolCallId: string;
  name: string;
  args?: Record<string, unknown>;
  status: 'running' | 'succeeded' | 'failed';
  result?: string;
  error?: string;
}

export type AgentRunStatus = 'queued' | 'running' | 'done';

export interface AgentRunInfo {
  runId: string;
  workspaceId: string;
  sessionId: string;
  clientId: string;
  senderName: string;
  prompt: string;
  status: AgentRunStatus;
  createdAt: number;
  startedAt?: number;
}

/** Full run state up to `seq`; sent when replay cannot cover a resume gap. */
export interface AgentRunSnapshot extends AgentRunInfo {
  seq: number;
  text: string;
  tools: AgentRunTool[];
  complete?: Record<string, unknown>;
}

export interface AgentRunContext {
  readonly info: AgentRunInfo;
  readonly signal: AbortSignal;
  emit(event: 'text_delta' | 'tool_call' | 'tool_result' | 'session', data: Record<string, unknown>): void;
}

/** Runs the turn; returns the `complete` payload. */
export type AgentRunExecutor = (ctx: AgentRunContext) => Promise<Record<string, unknown>>;

interface AgentRun {
  info: AgentRunInfo;
  execute: AgentRunExecutor;
  controller: AbortController;
  events: AgentRunEvent[];
  lastSeq: number;
  text: string;
  tools: Map<string, AgentRunTool>;
  complete?: Record<string, unknown>;
  subscribers: Set<ServerResponse>;
}

export interface AgentRunHubOptions {
  /** Called when a session's active run or queue changes. */
  onSessionChange?: (workspaceId: string, sessionId: string, active: AgentRunInfo | null, queue: AgentRunInfo[]) => void;
}

const sessionKey = (workspaceId: string, sessionId: string) => `${workspaceId}::${sessionId}`;

function frame(evt: AgentRunEvent): string {
  return `id: ${evt.seq}\nevent: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`;
}

/**
 * Owns agent runs independently of any HTTP connection. Each run keeps an
 * ordered event log, so a client that drops its stream resumes from the last
 * `seq` it saw. Runs for one session execute one at a time in FIFO order; the
 * daemon starts the next queued run itself, so no client has to stay online.
 */
export class AgentRunHub {
  private readonly runs = new Map<string, AgentRun>();
  private readonly active = new Map<string, AgentRun>();
  private readonly queues = new Map<string, AgentRun[]>();
  private readonly retention = new Map<string, ReturnType<typeof setTimeout>>();
  private closed = false;

  constructor(private readonly options: AgentRunHubOptions = {}) {}

  /** Start the run now, or queue it behind the session's active run. */
  submit(info: Omit<AgentRunInfo, 'status' | 'createdAt'>, execute: AgentRunExecutor): AgentRunInfo | { error: string } {
    if (this.closed) return { error: 'Daemon is shutting down.' };
    if (this.runs.has(info.runId)) return { error: `Run ${info.runId} already exists.` };
    const key = sessionKey(info.workspaceId, info.sessionId);
    const queue = this.queues.get(key) ?? [];
    if (this.active.has(key) && queue.length >= MAX_QUEUE_PER_SESSION) {
      return { error: 'Too many queued messages for this conversation.' };
    }
    const run: AgentRun = {
      info: { ...info, status: 'queued', createdAt: Date.now() },
      execute,
      controller: new AbortController(),
      events: [],
      lastSeq: 0,
      text: '',
      tools: new Map(),
      subscribers: new Set(),
    };
    this.runs.set(info.runId, run);
    if (this.active.has(key)) {
      queue.push(run);
      this.queues.set(key, queue);
      this.record(run, 'queued', { runId: info.runId, position: queue.length });
      this.notify(info.workspaceId, info.sessionId);
    } else {
      this.start(run);
    }
    return { ...run.info };
  }

  get(runId: string): AgentRunInfo | null {
    const run = this.runs.get(runId);
    return run ? { ...run.info } : null;
  }

  activeRun(workspaceId: string, sessionId: string): AgentRunInfo | null {
    const run = this.active.get(sessionKey(workspaceId, sessionId));
    return run ? { ...run.info } : null;
  }

  queued(workspaceId: string, sessionId: string): AgentRunInfo[] {
    return (this.queues.get(sessionKey(workspaceId, sessionId)) ?? []).map((run) => ({ ...run.info }));
  }

  snapshot(runId: string): AgentRunSnapshot | null {
    const run = this.runs.get(runId);
    if (!run) return null;
    return {
      ...run.info,
      seq: run.lastSeq,
      text: run.text,
      tools: [...run.tools.values()].map((tool) => ({ ...tool })),
      ...(run.complete ? { complete: { ...run.complete } } : {}),
    };
  }

  /** Abort the active run, or drop a queued one. Returns false when unknown or finished. */
  abort(runId: string): boolean {
    const run = this.runs.get(runId);
    if (!run || run.info.status === 'done') return false;
    if (run.info.status === 'running') {
      run.controller.abort();
      return true;
    }
    const key = sessionKey(run.info.workspaceId, run.info.sessionId);
    const queue = this.queues.get(key) ?? [];
    const index = queue.indexOf(run);
    if (index >= 0) queue.splice(index, 1);
    this.finish(run, { ok: false, stopped: true, runId, sessionId: run.info.sessionId, response: '', error: 'Aborted' });
    this.notify(run.info.workspaceId, run.info.sessionId);
    return true;
  }

  /**
   * Stream a run's events over SSE, starting after `after`. A gap the buffer
   * no longer covers is filled with one `snapshot` event. Closing the response
   * only unsubscribes; it never stops the run.
   */
  subscribe(req: IncomingMessage, res: ServerResponse, runId: string, after = 0): boolean {
    const run = this.runs.get(runId);
    if (!run) return false;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    const oldest = run.events[0]?.seq ?? run.lastSeq + 1;
    if (after < oldest - 1) {
      const snap = this.snapshot(runId)!;
      res.write(frame({ seq: snap.seq, event: 'snapshot', data: { ...snap } }));
    } else {
      for (const evt of run.events) {
        if (evt.seq > after) res.write(frame(evt));
      }
    }
    if (run.info.status === 'done') {
      res.end();
      return true;
    }
    run.subscribers.add(res);
    const keepalive = setInterval(() => {
      writeSseFrame(res, ': ping\n\n');
    }, KEEPALIVE_MS);
    keepalive.unref();
    const cleanup = () => {
      clearInterval(keepalive);
      run.subscribers.delete(res);
    };
    req.on('close', cleanup);
    res.on('close', cleanup);
    return true;
  }

  close(): void {
    this.closed = true;
    for (const queue of this.queues.values()) {
      for (const run of queue.splice(0)) {
        this.finish(run, { ok: false, stopped: true, runId: run.info.runId, sessionId: run.info.sessionId, response: '', error: 'Daemon stopped' });
      }
    }
    for (const run of this.active.values()) run.controller.abort();
    for (const timer of this.retention.values()) clearTimeout(timer);
    this.retention.clear();
  }

  private start(run: AgentRun): void {
    const { workspaceId, sessionId, runId } = run.info;
    const key = sessionKey(workspaceId, sessionId);
    this.active.set(key, run);
    run.info.status = 'running';
    run.info.startedAt = Date.now();
    this.record(run, 'started', { runId, sessionId, startedAt: run.info.startedAt });
    this.notify(workspaceId, sessionId);
    const ctx: AgentRunContext = {
      info: run.info,
      signal: run.controller.signal,
      emit: (event, data) => this.record(run, event, data),
    };
    void Promise.resolve()
      .then(() => run.execute(ctx))
      .catch((err: unknown) => ({
        ok: false,
        stopped: run.controller.signal.aborted,
        error: run.controller.signal.aborted ? 'Aborted' : err instanceof Error ? err.message : String(err),
      }))
      .then((complete) => {
        this.finish(run, { runId, sessionId, response: run.text, ...complete });
        if (this.active.get(key) === run) this.active.delete(key);
        const next = this.queues.get(key)?.shift();
        if (next && !this.closed) this.start(next);
        else this.notify(workspaceId, sessionId);
      });
  }

  private finish(run: AgentRun, complete: Record<string, unknown>): void {
    if (run.info.status === 'done') return;
    run.info.status = 'done';
    run.complete = complete;
    this.record(run, 'complete', complete);
    for (const res of run.subscribers) {
      try {
        res.end();
      } catch {
        // Ignore a broken pipe.
      }
    }
    run.subscribers.clear();
    const timer = setTimeout(() => {
      this.retention.delete(run.info.runId);
      this.runs.delete(run.info.runId);
    }, FINISHED_RUN_RETENTION_MS);
    timer.unref();
    this.retention.set(run.info.runId, timer);
  }

  private record(run: AgentRun, event: string, data: Record<string, unknown>): void {
    if (event === 'text_delta' && typeof data.delta === 'string') run.text += data.delta;
    if (event === 'tool_call' && typeof data.toolCallId === 'string') {
      run.tools.set(data.toolCallId, {
        toolCallId: data.toolCallId,
        name: typeof data.name === 'string' ? data.name : 'unknown',
        ...(data.args && typeof data.args === 'object' ? { args: data.args as Record<string, unknown> } : {}),
        status: 'running',
      });
    }
    if (event === 'tool_result' && typeof data.toolCallId === 'string') {
      const tool = run.tools.get(data.toolCallId);
      const status = data.status === 'failed' ? 'failed' : 'succeeded';
      run.tools.set(data.toolCallId, {
        toolCallId: data.toolCallId,
        name: tool?.name ?? (typeof data.name === 'string' ? data.name : 'unknown'),
        ...(tool?.args ? { args: tool.args } : {}),
        status,
        ...(typeof data.result === 'string' ? { result: data.result } : {}),
        ...(typeof data.error === 'string' ? { error: data.error } : {}),
      });
    }
    const evt: AgentRunEvent = { seq: ++run.lastSeq, event, data };
    run.events.push(evt);
    if (run.events.length > MAX_RUN_EVENTS) run.events.shift();
    const text = frame(evt);
    for (const res of run.subscribers) {
      if (!writeSseFrame(res, text)) run.subscribers.delete(res);
    }
  }

  private notify(workspaceId: string, sessionId: string): void {
    this.options.onSessionChange?.(
      workspaceId,
      sessionId,
      this.activeRun(workspaceId, sessionId),
      this.queued(workspaceId, sessionId),
    );
  }
}
