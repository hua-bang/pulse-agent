import type { CanvasWorkspaceApi } from '../../../../shared/api/workspace-api';
import type { WebHostAuthSession } from './types';

type PtyApi = CanvasWorkspaceApi['pty'];

export function createWebPtyClient(
  session: WebHostAuthSession,
  getActiveWorkspaceId: () => string | undefined,
): PtyApi {
  const dataListeners = new Map<string, Set<(data: string) => void>>();
  const exitListeners = new Map<string, Set<(exitCode: number) => void>>();
  const streamControllers = new Map<string, AbortController>();
  const snapshots = new Map<string, string>();

  const authHeaders = () => ({
    Authorization: `Bearer ${session.token}`,
    'Content-Type': 'application/json',
  });

  const emitData = (id: string, chunk: string) => {
    const set = dataListeners.get(id);
    if (!set) return;
    for (const cb of [...set]) {
      try {
        cb(chunk);
      } catch {
        // Isolate subscriber errors.
      }
    }
  };

  const emitExit = (id: string, exitCode: number) => {
    const set = exitListeners.get(id);
    if (!set) return;
    for (const cb of [...set]) {
      try {
        cb(exitCode);
      } catch {
        // Isolate subscriber errors.
      }
    }
  };

  const pendingWrites = new Map<string, string>();
  const flushingWrites = new Set<string>();
  const exitedSessions = new Set<string>();

  const flushWrites = async (id: string): Promise<void> => {
    if (flushingWrites.has(id)) return;
    flushingWrites.add(id);
    try {
      while (true) {
        const chunk = pendingWrites.get(id);
        if (!chunk) break;
        pendingWrites.delete(id);
        await fetch(`${session.endpoint}/v1/pty/${encodeURIComponent(id)}/write`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ data: chunk }),
        }).catch(() => undefined);
      }
    } finally {
      flushingWrites.delete(id);
      if (pendingWrites.has(id)) {
        void flushWrites(id);
      }
    }
  };

  function startStream(id: string, includeScrollback = true): void {
    const existing = streamControllers.get(id);
    if (existing) existing.abort();
    const controller = new AbortController();
    streamControllers.set(id, controller);
    exitedSessions.delete(id);

    const qs = includeScrollback ? '' : '?scrollback=0';
    const url = `${session.endpoint}/v1/pty/${encodeURIComponent(id)}/stream${qs}`;
    void (async () => {
      let sawExit = false;
      try {
        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${session.token}`,
            Accept: 'text/event-stream',
          },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          if (res.status === 404) exitedSessions.add(id);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
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
              if (dataLines.length > 0) {
                try {
                  const parsed = JSON.parse(dataLines.join('\n')) as {
                    data?: string;
                    exitCode?: number;
                  };
                  if (eventName === 'data' && typeof parsed.data === 'string') {
                    emitData(id, parsed.data);
                  } else if (eventName === 'exit') {
                    sawExit = true;
                    exitedSessions.add(id);
                    emitExit(id, typeof parsed.exitCode === 'number' ? parsed.exitCode : 0);
                  }
                } catch {
                  // Ignore malformed SSE frames.
                }
              }
              sep = buffer.indexOf('\n\n');
            }
          }
        } finally {
          reader.releaseLock();
        }
      } catch {
        // Ignore aborted or dropped streams.
      } finally {
        if (streamControllers.get(id) === controller) {
          streamControllers.delete(id);
          if (!controller.signal.aborted && !sawExit && !exitedSessions.has(id) && dataListeners.has(id)) {
            window.setTimeout(() => {
              if (!streamControllers.has(id) && !exitedSessions.has(id) && dataListeners.has(id)) {
                startStream(id, false);
              }
            }, 1200);
          }
        }
      }
    })();
  }

  return {
    spawn: async (id, cols, rows, cwd, workspaceId, env) => {
      if (session.role === 'viewer') {
        return { ok: false, error: 'Read-only viewer role cannot open remote terminals.' };
      }
      const targetWs = session.workspaceId || workspaceId || getActiveWorkspaceId();
      try {
        const res = await fetch(`${session.endpoint}/v1/pty/spawn`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            id,
            ...(targetWs ? { workspaceId: targetWs } : {}),
            ...(typeof cols === 'number' ? { cols } : {}),
            ...(typeof rows === 'number' ? { rows } : {}),
            ...(cwd && !cwd.startsWith('/Users/') ? { cwd } : {}),
            ...(env ? { env } : {}),
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          pid?: number;
          reused?: boolean;
          error?: string;
        };
        if (!res.ok || !body.ok) {
          return { ok: false, error: body.error || `PTY spawn failed (HTTP ${res.status})` };
        }
        startStream(id, true);
        return { ok: true, pid: body.pid, reused: body.reused };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    write: (id, data) => {
      if (session.role === 'viewer') return;
      pendingWrites.set(id, (pendingWrites.get(id) ?? '') + data);
      queueMicrotask(() => {
        void flushWrites(id);
      });
    },
    resize: (id, cols, rows) => {
      if (session.role === 'viewer') return;
      void fetch(`${session.endpoint}/v1/pty/${encodeURIComponent(id)}/resize`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ cols, rows }),
      }).catch(() => undefined);
    },
    kill: (id) => {
      exitedSessions.add(id);
      pendingWrites.delete(id);
      const ctrl = streamControllers.get(id);
      if (ctrl) {
        ctrl.abort();
        streamControllers.delete(id);
      }
      if (session.role === 'viewer') return;
      void fetch(`${session.endpoint}/v1/pty/${encodeURIComponent(id)}/kill`, {
        method: 'POST',
        headers: authHeaders(),
      }).catch(() => undefined);
    },
    getCwd: async (id) => {
      try {
        const res = await fetch(`${session.endpoint}/v1/pty/${encodeURIComponent(id)}/cwd`, {
          headers: { Authorization: `Bearer ${session.token}` },
        });
        if (!res.ok) return { ok: false, cwd: null };
        const body = (await res.json()) as { ok?: boolean; cwd?: string | null };
        return { ok: Boolean(body.ok), cwd: body.cwd ?? null };
      } catch {
        return { ok: false, cwd: null };
      }
    },
    publishSnapshot: (id, text) => {
      snapshots.set(id, text);
    },
    getScrollback: async (id, maxChars) => {
      try {
        const q = typeof maxChars === 'number' ? `?maxChars=${maxChars}` : '';
        const res = await fetch(`${session.endpoint}/v1/pty/${encodeURIComponent(id)}/scrollback${q}`, {
          headers: { Authorization: `Bearer ${session.token}` },
        });
        if (!res.ok) {
          const cached = snapshots.get(id);
          return cached !== undefined ? { ok: true, text: cached } : { ok: false, error: `HTTP ${res.status}` };
        }
        const body = (await res.json()) as { ok?: boolean; text?: string; error?: string };
        return { ok: Boolean(body.ok), text: body.text, error: body.error };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    checkCommand: async (command) => {
      try {
        const res = await fetch(
          `${session.endpoint}/v1/runtime/check-command?command=${encodeURIComponent(command)}`,
          { headers: { Authorization: `Bearer ${session.token}` } },
        );
        if (!res.ok) return { ok: false, available: false };
        const body = (await res.json()) as { ok?: boolean; available?: boolean; path?: string };
        return { ok: Boolean(body.ok), available: Boolean(body.available), path: body.path };
      } catch {
        return { ok: false, available: false };
      }
    },
    onData: (id, callback) => {
      let set = dataListeners.get(id);
      if (!set) {
        set = new Set();
        dataListeners.set(id, set);
      }
      set.add(callback);
      return () => {
        set?.delete(callback);
        if (set && set.size === 0) dataListeners.delete(id);
      };
    },
    onExit: (id, callback) => {
      let set = exitListeners.get(id);
      if (!set) {
        set = new Set();
        exitListeners.set(id, set);
      }
      set.add(callback);
      return () => {
        set?.delete(callback);
        if (set && set.size === 0) exitListeners.delete(id);
      };
    },
  };
}
