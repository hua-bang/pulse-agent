import type { ResolvedRemoteTarget } from './client';

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
  target: ResolvedRemoteTarget,
  payload: {
    id: string;
    cols: number;
    rows: number;
    cwd?: string;
    env?: Record<string, string | undefined>;
  },
  callbacks: RemotePtyCallbacks,
): Promise<{ ok: true; handle: RemotePtyHandle; reused: boolean } | { ok: false; error: string }> {
  const spawnRes = await fetch(`${target.endpoint}/v1/pty/spawn`, {
    method: 'POST',
    headers: authHeaders(target.token, true),
    body: JSON.stringify({
      id: payload.id,
      cols: payload.cols,
      rows: payload.rows,
      cwd: payload.cwd || target.cwd,
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
  const streamController = new AbortController();
  let detached = false;

  const consumeStream = async () => {
    try {
      const res = await fetch(`${target.endpoint}/v1/pty/${encodedId}/stream?scrollback=1`, {
        method: 'GET',
        headers: { ...authHeaders(target.token), Accept: 'text/event-stream' },
        signal: streamController.signal,
      });
      if (!res.ok || !res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (!detached) {
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
      // Transient drop or explicit detach: VPS process stays alive for reattach.
    }
  };
  void consumeStream();

  const handle: RemotePtyHandle = {
    id: payload.id,
    pid: spawnJson.pid,
    write(data: string) {
      void fetch(`${target.endpoint}/v1/pty/${encodedId}/write`, {
        method: 'POST',
        headers: authHeaders(target.token, true),
        body: JSON.stringify({ data }),
      }).catch(() => undefined);
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
      streamController.abort();
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
      streamController.abort();
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
