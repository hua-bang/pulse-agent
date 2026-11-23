import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

interface PendingRelayCall {
  client: ServerResponse;
  timer: ReturnType<typeof setTimeout>;
  resolve: (result: RelayResponsePayload) => void;
}

export interface RelayResponsePayload {
  ok: boolean;
  value?: unknown;
  error?: { code?: string; message?: string; details?: unknown };
}

const DEFAULT_LIST_TIMEOUT_MS = 5_000;
const DEFAULT_CALL_TIMEOUT_MS = 15_000;

/**
 * Pull-based capability relay between local `pulse-canvas` CLI callers on the VPS
 * and connected Pulse Canvas desktop clients over the existing HTTP/SSE channel.
 *
 * The desktop client initiates the outbound SSE connection (`GET /v1/runtime/relay/events`)
 * and enforces its own workspace scope and read-only capability allowlist before
 * posting results back to `POST /v1/runtime/relay/respond`. No SSH `-R` port or
 * local runtime secret is ever exposed to the VPS.
 */
export class CapabilityRelay {
  private readonly clientsByWorkspace = new Map<string, Set<ServerResponse>>();
  private readonly pending = new Map<string, PendingRelayCall>();
  private readonly heartbeats = new Map<ServerResponse, ReturnType<typeof setInterval>>();

  subscribe(req: IncomingMessage, res: ServerResponse, workspaceId: string): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');

    let set = this.clientsByWorkspace.get(workspaceId);
    if (!set) {
      set = new Set();
      this.clientsByWorkspace.set(workspaceId, set);
    }
    set.add(res);

    const heartbeat = setInterval(() => {
      if (!res.writableEnded) {
        res.write(': heartbeat\n\n');
      }
    }, 25_000);
    heartbeat.unref?.();
    this.heartbeats.set(res, heartbeat);

    req.on('close', () => {
      this.removeClient(workspaceId, res);
    });
  }

  private removeClient(workspaceId: string, res: ServerResponse): void {
    const hb = this.heartbeats.get(res);
    if (hb) {
      clearInterval(hb);
      this.heartbeats.delete(res);
    }
    const set = this.clientsByWorkspace.get(workspaceId);
    if (set) {
      set.delete(res);
      if (set.size === 0) this.clientsByWorkspace.delete(workspaceId);
    }
    for (const [id, entry] of this.pending) {
      if (entry.client === res) {
        clearTimeout(entry.timer);
        this.pending.delete(id);
        entry.resolve({
          ok: false,
          error: {
            code: 'runtime_unreachable',
            message: 'Connected Pulse Canvas desktop client disconnected.',
          },
        });
      }
    }
  }

  private pickClient(workspaceId?: string): ServerResponse | null {
    if (workspaceId) {
      const set = this.clientsByWorkspace.get(workspaceId);
      if (!set || set.size === 0) return null;
      for (const client of set) {
        if (!client.writableEnded) return client;
      }
      return null;
    }
    for (const set of this.clientsByWorkspace.values()) {
      for (const client of set) {
        if (!client.writableEnded) return client;
      }
    }
    return null;
  }

  private dispatch(
    client: ServerResponse,
    eventName: 'capability_list' | 'capability_call',
    payload: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<RelayResponsePayload> {
    const id = randomUUID();
    return new Promise<RelayResponsePayload>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({
          ok: false,
          error: {
            code: 'runtime_timeout',
            message: `Timed out waiting for connected Pulse Canvas desktop client (${timeoutMs}ms).`,
          },
        });
      }, timeoutMs);
      timer.unref?.();

      this.pending.set(id, { client, timer, resolve });
      client.write(`event: ${eventName}\ndata: ${JSON.stringify({ ...payload, id })}\n\n`);
    });
  }

  respond(id: string, payload: RelayResponsePayload): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(id);
    entry.resolve(payload);
    return true;
  }

  async listCapabilities(workspaceId?: string): Promise<
    | { ok: true; capabilities: unknown[] }
    | { ok: false; error: { code: string; message: string } }
  > {
    const client = this.pickClient(workspaceId);
    if (!client) {
      return {
        ok: false,
        error: {
          code: 'runtime_unreachable',
          message: 'No Pulse Canvas desktop client is currently connected to this VPS.',
        },
      };
    }
    const res = await this.dispatch(client, 'capability_list', {}, DEFAULT_LIST_TIMEOUT_MS);
    if (!res.ok) {
      return {
        ok: false,
        error: {
          code: res.error?.code || 'runtime_error',
          message: res.error?.message || 'Failed to list remote capabilities.',
        },
      };
    }
    return { ok: true, capabilities: Array.isArray(res.value) ? res.value : [] };
  }

  async callCapability(request: {
    workspaceId: string;
    name: string;
    input?: unknown;
    timeoutMs?: number;
  }): Promise<RelayResponsePayload> {
    const workspaceId = request.workspaceId.trim();
    if (!workspaceId) {
      return {
        ok: false,
        error: { code: 'invalid_request', message: 'workspaceId is required' },
      };
    }
    const client = this.pickClient(workspaceId);
    if (!client) {
      return {
        ok: false,
        error: {
          code: 'runtime_unreachable',
          message: `No Pulse Canvas desktop client is currently connected for workspace ${workspaceId}.`,
        },
      };
    }
    const timeoutMs =
      typeof request.timeoutMs === 'number' && request.timeoutMs > 0
        ? Math.min(request.timeoutMs, 60_000)
        : DEFAULT_CALL_TIMEOUT_MS;
    return await this.dispatch(
      client,
      'capability_call',
      {
        workspaceId,
        name: request.name,
        input: request.input ?? {},
      },
      timeoutMs,
    );
  }

  closeAll(): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      this.pending.delete(id);
      entry.resolve({
        ok: false,
        error: { code: 'runtime_unreachable', message: 'VPS daemon shutting down.' },
      });
    }
    for (const hb of this.heartbeats.values()) {
      clearInterval(hb);
    }
    this.heartbeats.clear();
    for (const set of this.clientsByWorkspace.values()) {
      for (const client of set) {
        if (!client.writableEnded) client.end();
      }
    }
    this.clientsByWorkspace.clear();
  }
}
