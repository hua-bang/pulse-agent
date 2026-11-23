import { resolveRemoteWorkspaceTarget } from './client';

export type RemoteBuiltinToolResult =
  | { handled: false }
  | { handled: true; result: unknown };

export async function tryExecuteRemoteBuiltinTool(
  workspaceId: string,
  tool: string,
  input: Record<string, unknown>,
  abortSignal?: AbortSignal,
): Promise<RemoteBuiltinToolResult> {
  const target = await resolveRemoteWorkspaceTarget(workspaceId, 'runtime');
  if (!target) {
    return { handled: false };
  }

  const res = await fetch(`${target.endpoint}/v1/tools/exec`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${target.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ tool, input, cwd: target.cwd }),
    signal: abortSignal,
  });

  if (res.status === 404) {
    throw new Error(
      'Remote VPS daemon does not support /v1/tools/exec yet. Reconnect or upgrade the VPS daemon in Workspace Settings.',
    );
  }

  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: unknown;
    error?: string;
    message?: string;
  };

  if (!res.ok || body.ok === false) {
    throw new Error(body.error || body.message || `Remote tool ${tool} failed (HTTP ${res.status})`);
  }

  return { handled: true, result: body.result };
}
