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
}

export interface RuntimeClientError {
  code: string;
  message: string;
  details?: unknown;
}

export type RuntimeClientResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: RuntimeClientError };

async function postRuntimeSafely(
  runtime: RuntimeInfo,
  path: string,
  body: object,
): Promise<RuntimeClientResult<unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
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
  );
  if (!response.ok) return response;
  const payload = response.value as { value?: unknown };
  return { ok: true, value: payload.value };
}
