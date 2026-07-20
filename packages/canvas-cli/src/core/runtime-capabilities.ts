import { tryReadRuntime, type RuntimeInfo } from './runtime-control';

export type RuntimeCapabilityRisk = 'read' | 'operate' | 'unsafe';

export interface RuntimeCapabilityDescriptor {
  name: string;
  description: string;
  risk: RuntimeCapabilityRisk;
  inputSchema: unknown;
}

export interface RuntimeCapabilityRequest {
  workspaceId: string;
  name: string;
  input?: unknown;
  transportTimeoutMs?: number;
}

export interface RuntimeClientError {
  code: string;
  message: string;
  details?: unknown;
}

export type RuntimeClientResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: RuntimeClientError };

const DEFAULT_TRANSPORT_TIMEOUT_MS = 5_000;
const PAGE_EVAL_TRANSPORT_BUFFER_MS = 1_000;
const CHAT_DISPATCH_TRANSPORT_TIMEOUT_MS = 7_000;
const MAX_TIMER_MS = 2_147_483_647;
export const MAX_PAGE_EVAL_TIMEOUT_MS = MAX_TIMER_MS - PAGE_EVAL_TRANSPORT_BUFFER_MS;

async function postRuntimeSafely(
  runtime: RuntimeInfo,
  path: string,
  body: object,
  timeoutMs = DEFAULT_TRANSPORT_TIMEOUT_MS,
): Promise<RuntimeClientResult<unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${runtime.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${runtime.secret}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let payload: any;
    try {
      payload = await response.json();
    } catch {
      return {
        ok: false,
        error: {
          code: 'runtime_invalid_response',
          message: `Pulse Canvas returned a non-JSON response (HTTP ${response.status}).`,
        },
      };
    }
    if (payload?.ok === false) {
      const remoteError = payload.error;
      return {
        ok: false,
        error: typeof remoteError === 'object' && remoteError
          ? {
              code: typeof remoteError.code === 'string' ? remoteError.code : 'runtime_error',
              message: typeof remoteError.message === 'string'
                ? remoteError.message
                : `Pulse Canvas rejected the capability call (HTTP ${response.status}).`,
              ...(remoteError.details === undefined ? {} : { details: remoteError.details }),
            }
          : {
              code: response.status === 404
                ? 'capability_runtime_unavailable'
                : response.status === 401
                  ? 'runtime_auth'
                  : 'runtime_error',
              message: typeof remoteError === 'string'
                ? remoteError
                : `Pulse Canvas rejected the capability call (HTTP ${response.status}).`,
            },
      };
    }
    return { ok: true, value: payload };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: error instanceof Error && error.name === 'AbortError'
          ? 'runtime_timeout'
          : 'runtime_unreachable',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function listRuntimeCapabilities(): Promise<RuntimeClientResult<RuntimeCapabilityDescriptor[]>> {
  const discovered = await tryReadRuntime();
  if (!discovered.ok) return discovered;

  const response = await postRuntimeSafely(discovered.value, '/capabilities/list', {});
  if (!response.ok) return response;
  const payload = response.value as { capabilities?: RuntimeCapabilityDescriptor[] };
  if (!Array.isArray(payload.capabilities)) {
    return {
      ok: false,
      error: {
        code: 'runtime_invalid_response',
        message: 'Pulse Canvas capability list is missing capabilities.',
      },
    };
  }
  return { ok: true, value: payload.capabilities };
}

export async function callRuntimeCapability(
  request: RuntimeCapabilityRequest,
): Promise<RuntimeClientResult<unknown>> {
  const discovered = await tryReadRuntime();
  if (!discovered.ok) return discovered;

  const response = await postRuntimeSafely(
    discovered.value,
    '/capabilities/call',
    {
      workspaceId: request.workspaceId,
      name: request.name,
      input: request.input ?? {},
    },
    resolveRuntimeTransportTimeout(request),
  );
  if (!response.ok) return response;
  const payload = response.value as { value?: unknown };
  return { ok: true, value: payload.value };
}

export function resolveRuntimeTransportTimeout(request: RuntimeCapabilityRequest): number {
  if (request.transportTimeoutMs !== undefined) return request.transportTimeoutMs;
  // Canvas Agent chat may need to mount its dock panel before its handler can
  // accept the first request. The app itself retries for five seconds.
  if (request.name === 'canvas.agent.chat') return CHAT_DISPATCH_TRANSPORT_TIMEOUT_MS;
  if (request.name !== 'browser.page.eval' && request.name !== 'host.renderer.eval') {
    return DEFAULT_TRANSPORT_TIMEOUT_MS;
  }

  const input = request.input && typeof request.input === 'object'
    ? request.input as Record<string, unknown>
    : {};
  const requested = input.timeoutMs;
  const executionTimeout = typeof requested === 'number'
    && Number.isInteger(requested)
    && requested > 0
    ? Math.min(requested, MAX_PAGE_EVAL_TIMEOUT_MS)
    : DEFAULT_TRANSPORT_TIMEOUT_MS;
  return executionTimeout + PAGE_EVAL_TRANSPORT_BUFFER_MS;
}
