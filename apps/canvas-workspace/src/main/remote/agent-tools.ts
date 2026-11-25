import { resolveRemoteWorkspaceTarget } from './client';

export type RemoteBuiltinToolResult =
  | { handled: false }
  | { handled: true; result: unknown };

export async function tryExecuteRemoteBuiltinTool(
  workspaceId: string,
  tool: string,
  input: Record<string, unknown>,
  abortSignal?: AbortSignal,
  onOutput?: (chunk: string, stream: 'stdout' | 'stderr') => void,
): Promise<RemoteBuiltinToolResult> {
  const target = await resolveRemoteWorkspaceTarget(workspaceId, 'runtime');
  if (!target) {
    return { handled: false };
  }

  const wantsStream = Boolean(onOutput) && tool === 'bash';
  const res = await fetch(`${target.endpoint}/v1/tools/exec`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${target.token}`,
      'Content-Type': 'application/json',
      ...(wantsStream ? { Accept: 'text/event-stream' } : {}),
    },
    body: JSON.stringify({ tool, input, cwd: target.cwd }),
    signal: abortSignal,
  });

  if (res.status === 404) {
    throw new Error(
      'Remote VPS daemon does not support /v1/tools/exec yet. Reconnect or upgrade the VPS daemon in Workspace Settings.',
    );
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (wantsStream && res.ok && res.body && contentType.includes('text/event-stream')) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let finalResult: unknown;
    let hasResult = false;

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
            stream?: 'stdout' | 'stderr';
            text?: string;
            result?: unknown;
            error?: string;
          };
          if (eventName === 'chunk' && typeof parsed.text === 'string') {
            onOutput?.(parsed.text, parsed.stream === 'stderr' ? 'stderr' : 'stdout');
          } else if (eventName === 'error') {
            throw new Error(parsed.error || `Remote tool ${tool} failed`);
          } else if (eventName === 'result') {
            finalResult = parsed.result;
            hasResult = true;
          }
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
    if (!hasResult) {
      throw new Error(`Remote tool ${tool} stream ended without a result`);
    }
    return { handled: true, result: finalResult };
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
