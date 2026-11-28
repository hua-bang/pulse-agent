import { existsSync } from 'node:fs';
import type { ResolvedRemoteTarget } from './client';

/**
 * Terminals pass the workspace's desktop folder as `cwd`. That folder exists on
 * this machine, not on the VPS, so it must not override the configured VPS
 * folder. A cwd restored from a remote session (a VPS path) is kept.
 */
export function resolveRemoteSpawnCwd(
  requested: string | undefined,
  configured: string | undefined,
  isLocalPath: (dir: string) => boolean = existsSync,
): string | undefined {
  const dir = requested?.trim();
  if (dir && !isLocalPath(dir)) return dir;
  return configured?.trim() || undefined;
}

export interface RemotePtyCallbacks {
  onData: (data: string) => void;
  onExit: (exitCode: number) => void;
}

export interface RemotePtyHandle {
  readonly id: string;
  readonly pid?: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  getCwd(): Promise<string | null>;
  getScrollback(maxChars?: number): Promise<string | null>;
  detach(): void;
}

function authHeaders(token: string, json = false): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

/**
 * Spawn or attach to a persistent PTY session on the VPS daemon.
 * Output streams over SSE; input/resize/kill use authenticated HTTP POSTs.
 */
export async function connectRemotePty(
  initialTarget: ResolvedRemoteTarget,
  payload: {
    id: string;
    cols: number;
    rows: number;
    cwd?: string;
    env?: Record<string, string | undefined>;
  },
  callbacks: RemotePtyCallbacks,
  /**
   * Re-resolves the endpoint before each reconnect. An SSH tunnel restart binds
   * a new local port, so the endpoint captured at spawn time can go stale.
   */
  refreshTarget?: () => Promise<ResolvedRemoteTarget | null>,
): Promise<{ ok: true; handle: RemotePtyHandle; reused: boolean } | { ok: false; error: string }> {
  let target = initialTarget;
  const refresh = async () => {
    if (!refreshTarget) return;
    try {
      const next = await refreshTarget();
      if (next) target = next;
    } catch {
      // Keep the last known target; the next retry tries again.
    }
  };
  const spawnRes = await fetch(`${target.endpoint}/v1/pty/spawn`, {
    method: 'POST',
    headers: authHeaders(target.token, true),
    body: JSON.stringify({
      id: payload.id,
      workspaceId: target.remoteWorkspaceId,
      cols: payload.cols,
      rows: payload.rows,
      cwd: resolveRemoteSpawnCwd(payload.cwd, target.cwd),
      ...(target.cwd ? { fallbackCwd: target.cwd } : {}),
      env: payload.env,
    }),
  });
  const spawnJson = (await spawnRes.json()) as {
    ok: boolean;
    pid?: number;
    reused?: boolean;
    error?: string;
  };
  if (!spawnRes.ok || !spawnJson.ok) {
    return { ok: false, error: spawnJson.error || `Remote PTY spawn failed (${spawnRes.status})` };
  }

  const encodedId = encodeURIComponent(payload.id);
  let streamController: AbortController | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let detached = false;
  let exited = false;
  let firstConnect = true;
  let reconnectDelayMs = 1_000;

  const consumeStream = async () => {
    while (!detached && !exited) {
      streamController = new AbortController();
      const scrollbackParam = firstConnect ? '1' : '0';
      firstConnect = false;
      try {
        const res = await fetch(
          `${target.endpoint}/v1/pty/${encodedId}/stream?scrollback=${scrollbackParam}`,
          {
            method: 'GET',
            headers: { ...authHeaders(target.token), Accept: 'text/event-stream' },
            signal: streamController.signal,
          },
        );
        if (res.status === 404 || res.status === 401 || res.status === 403) {
          // The session is gone (daemon restarted) or access was revoked.
          // Report an exit so the terminal does not look alive while dead.
          exited = true;
          callbacks.onExit(1);
          return;
        }
        if (!res.ok || !res.body) {
          throw new Error(`PTY stream HTTP ${res.status}`);
        }
        reconnectDelayMs = 1_000;
        const reader = res.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (!detached && !exited) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary = buffer.indexOf('\n\n');
          while (boundary >= 0) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            let eventName = 'message';
            let dataLine = '';
            for (const line of block.split('\n')) {
              if (line.startsWith('event:')) eventName = line.slice(6).trim();
              else if (line.startsWith('data:')) dataLine += line.slice(5).trim();
            }
            if (dataLine) {
              try {
                const parsed = JSON.parse(dataLine) as { data?: string; exitCode?: number };
                if (eventName === 'data' && typeof parsed.data === 'string') {
                  callbacks.onData(parsed.data);
                } else if (eventName === 'exit') {
                  exited = true;
                  callbacks.onExit(parsed.exitCode ?? 0);
                  return;
                }
              } catch {
                // Ignore keepalive or malformed frame.
              }
            }
            boundary = buffer.indexOf('\n\n');
          }
        }
      } catch {
        // Transient drop: retry with bounded backoff unless detached or exited.
      }
      if (detached || exited) return;
      await new Promise<void>((resolveWait) => {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          resolveWait();
        }, reconnectDelayMs);
        reconnectTimer.unref?.();
      });
      reconnectDelayMs = Math.min(reconnectDelayMs * 2, 5_000);
      await refresh();
    }
  };
  void consumeStream();

  // Ordered micro-batched write queue so rapid typing never arrives out-of-order.
  let pendingWrite = '';
  let writeFlushTimer: ReturnType<typeof setTimeout> | null = null;
  let writeInFlight: Promise<void> = Promise.resolve();

  const flushWrites = () => {
    writeFlushTimer = null;
    if (!pendingWrite || detached || exited) return;
    const batch = pendingWrite;
    pendingWrite = '';
    writeInFlight = writeInFlight
      .then(async () => {
        if (detached || exited) return;
        const send = () => fetch(`${target.endpoint}/v1/pty/${encodedId}/write`, {
          method: 'POST',
          headers: authHeaders(target.token, true),
          body: JSON.stringify({ data: batch }),
        });
        try {
          await send();
        } catch {
          // A network error usually means the tunnel moved; retry once on the
          // fresh endpoint so keystrokes are not silently dropped.
          await refresh();
          await send();
        }
      })
      .catch(() => undefined);
  };

  const handle: RemotePtyHandle = {
    id: payload.id,
    pid: spawnJson.pid,
    write(data: string) {
      if (!data || detached || exited) return;
      pendingWrite += data;
      if (pendingWrite.length >= 256 || data.includes('\r') || data.includes('\n')) {
        if (writeFlushTimer) {
          clearTimeout(writeFlushTimer);
          writeFlushTimer = null;
        }
        flushWrites();
      } else if (!writeFlushTimer) {
        writeFlushTimer = setTimeout(flushWrites, 8);
      }
    },
    resize(cols: number, rows: number) {
      void fetch(`${target.endpoint}/v1/pty/${encodedId}/resize`, {
        method: 'POST',
        headers: authHeaders(target.token, true),
        body: JSON.stringify({ cols, rows }),
      }).catch(() => undefined);
    },
    kill() {
      detached = true;
      exited = true;
      if (writeFlushTimer) clearTimeout(writeFlushTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      streamController?.abort();
      void fetch(`${target.endpoint}/v1/pty/${encodedId}/kill`, {
        method: 'POST',
        headers: authHeaders(target.token, true),
      }).catch(() => undefined);
    },
    async getCwd() {
      const res = await fetch(`${target.endpoint}/v1/pty/${encodedId}/cwd`, {
        headers: authHeaders(target.token),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { ok: boolean; cwd?: string | null };
      return json.cwd ?? null;
    },
    async getScrollback(maxChars?: number) {
      const qs = maxChars ? `?maxChars=${maxChars}` : '';
      const res = await fetch(`${target.endpoint}/v1/pty/${encodedId}/scrollback${qs}`, {
        headers: authHeaders(target.token),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { ok: boolean; text?: string };
      return json.text ?? null;
    },
    detach() {
      detached = true;
      if (writeFlushTimer) clearTimeout(writeFlushTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      streamController?.abort();
    },
  };

  return { ok: true, handle, reused: !!spawnJson.reused };
}

export async function runRemoteJsonlCli(
  target: ResolvedRemoteTarget,
  run: {
    command: string;
    args: string[];
    cwd?: string;
    prompt: string;
    abortSignal: AbortSignal;
    timeoutMs?: number;
    onLine: (line: string) => void;
  },
): Promise<{ code: number | null; stderrTail: string }> {
  const res = await fetch(`${target.endpoint}/v1/exec-jsonl`, {
    method: 'POST',
    headers: { ...authHeaders(target.token, true), Accept: 'text/event-stream' },
    body: JSON.stringify({
      command: run.command,
      args: run.args,
      cwd: run.cwd || target.cwd,
      prompt: run.prompt,
      timeoutMs: run.timeoutMs,
    }),
    signal: run.abortSignal,
  });
  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Remote exec-jsonl failed (${res.status}): ${errText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let exitResult: { code: number | null; stderrTail: string } = { code: null, stderrTail: '' };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let eventName = 'message';
      let dataLine = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLine += line.slice(5).trim();
      }
      if (dataLine) {
        const parsed = JSON.parse(dataLine) as {
          line?: string;
          code?: number | null;
          stderrTail?: string;
          message?: string;
        };
        if (eventName === 'line' && typeof parsed.line === 'string') {
          run.onLine(parsed.line);
        } else if (eventName === 'error') {
          throw new Error(parsed.message || 'Remote external agent failed');
        } else if (eventName === 'exit') {
          exitResult = { code: parsed.code ?? null, stderrTail: parsed.stderrTail ?? '' };
        }
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
  return exitResult;
}
