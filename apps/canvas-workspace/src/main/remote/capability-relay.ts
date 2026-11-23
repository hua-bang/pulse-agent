import type { ResolvedRemoteTarget } from './client';
import { getRemoteCapabilityExecutor, type RemoteCapabilityExecutor } from './capability-port';

/**
 * Strict read-only allowlist of desktop capabilities that a remote VPS
 * (`pulse-canvas` CLI) may request from a connected Pulse Canvas desktop client.
 *
 * Unsafe or mutating desktop capabilities (`host.renderer.eval`, `plugins.install`,
 * `browser.page.eval`, `browser.page.click`, `browser.page.fill`, `browser.tabs.open`,
 * `browser.tabs.activate`, `canvas.nodes.update`) are deliberately excluded.
 */
export const ALLOWED_REMOTE_RELAY_CAPABILITIES = new Set<string>([
  'browser.page.read',
  'browser.page.selection',
  'browser.tabs.list',
  'browser.plugin-pages.list',
  'canvas.nodes.read',
  'canvas.nodes.search',
]);

interface RelayEventPayload {
  id?: string;
  workspaceId?: string;
  name?: string;
  input?: unknown;
}

export interface CapabilityRelaySubscriptionOptions {
  resolveExecutor?: () => RemoteCapabilityExecutor | null;
  reconnectDelayMs?: number;
}

async function postRelayResponse(
  target: ResolvedRemoteTarget,
  payload: {
    id: string;
    ok: boolean;
    value?: unknown;
    error?: { code: string; message: string; details?: unknown };
  },
): Promise<void> {
  await fetch(`${target.endpoint}/v1/runtime/relay/respond`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${target.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  }).catch(() => undefined);
}

async function handleRelayEvent(
  target: ResolvedRemoteTarget,
  eventName: string,
  rawData: string,
  resolveExecutor: () => RemoteCapabilityExecutor | null,
): Promise<void> {
  let payload: RelayEventPayload;
  try {
    payload = JSON.parse(rawData) as RelayEventPayload;
  } catch {
    return;
  }
  const id = typeof payload.id === 'string' ? payload.id : '';
  if (!id) return;

  const executor = resolveExecutor();
  if (!executor) {
    await postRelayResponse(target, {
      id,
      ok: false,
      error: {
        code: 'runtime_unreachable',
        message: 'Desktop capability runtime is not initialized.',
      },
    });
    return;
  }

  if (eventName === 'capability_list') {
    try {
      const descriptors = executor
        .list()
        .filter((item) => ALLOWED_REMOTE_RELAY_CAPABILITIES.has(item.name));
      await postRelayResponse(target, { id, ok: true, value: descriptors });
    } catch (err) {
      await postRelayResponse(target, {
        id,
        ok: false,
        error: {
          code: 'runtime_error',
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
    return;
  }

  if (eventName === 'capability_call') {
    const name = typeof payload.name === 'string' ? payload.name : '';
    const requestedWorkspaceId = typeof payload.workspaceId === 'string' ? payload.workspaceId : '';

    if (!ALLOWED_REMOTE_RELAY_CAPABILITIES.has(name)) {
      await postRelayResponse(target, {
        id,
        ok: false,
        error: {
          code: 'capability_forbidden',
          message: `Capability "${name}" is not allowed over remote VPS relay (read-only allowlist).`,
        },
      });
      return;
    }

    if (requestedWorkspaceId !== target.remoteWorkspaceId) {
      await postRelayResponse(target, {
        id,
        ok: false,
        error: {
          code: 'capability_forbidden',
          message: `Remote relay is scoped to workspace "${target.remoteWorkspaceId}".`,
        },
      });
      return;
    }

    try {
      const result = await executor.call(name, payload.input ?? {}, target.workspaceId);
      if (result.ok) {
        await postRelayResponse(target, { id, ok: true, value: result.value });
      } else {
        await postRelayResponse(target, { id, ok: false, error: result.error });
      }
    } catch (err) {
      await postRelayResponse(target, {
        id,
        ok: false,
        error: {
          code: 'runtime_error',
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }
}

/**
 * Maintain a persistent outbound SSE relay connection to `vps-daemon` for a bound
 * VPS workspace so `pulse-canvas` CLI on the VPS can invoke read-only desktop
 * capabilities (such as `browser.page.read`) without SSH `-R` reverse ports.
 */
export function startRemoteCapabilityRelay(
  target: ResolvedRemoteTarget,
  options: CapabilityRelaySubscriptionOptions = {},
): () => void {
  let stopped = false;
  let controller: AbortController | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const reconnectDelayMs = options.reconnectDelayMs ?? 2_000;
  const resolveExecutor = options.resolveExecutor ?? getRemoteCapabilityExecutor;

  const connect = async (): Promise<void> => {
    if (stopped) return;
    controller = new AbortController();
    const url = `${target.endpoint}/v1/runtime/relay/events?workspaceId=${encodeURIComponent(
      target.remoteWorkspaceId,
    )}`;

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${target.token}`,
          Accept: 'text/event-stream',
        },
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        // 403 (viewer/editor share role) or 404 (older daemon) — do not spin tightly.
        if (res.status === 401 || res.status === 403 || res.status === 404) {
          return;
        }
        throw new Error(`Capability relay HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);

          let eventName = 'message';
          const dataLines: string[] = [];
          for (const rawLine of frame.split('\n')) {
            const line = rawLine.replace(/\r$/, '');
            if (!line || line.startsWith(':')) continue;
            if (line.startsWith('event:')) {
              eventName = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              dataLines.push(line.slice(5).trimStart());
            }
          }
          if (dataLines.length > 0 && (eventName === 'capability_list' || eventName === 'capability_call')) {
            void handleRelayEvent(target, eventName, dataLines.join('\n'), resolveExecutor);
          }
          boundary = buffer.indexOf('\n\n');
        }
      }
    } catch {
      // Reconnect below unless explicitly stopped.
    }

    if (!stopped) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, reconnectDelayMs);
      reconnectTimer.unref?.();
    }
  };

  void connect();

  return () => {
    stopped = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    controller?.abort();
    controller = null;
  };
}
