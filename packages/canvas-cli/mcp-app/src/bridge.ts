import type { App } from '@modelcontextprotocol/ext-apps';

export class ToolCallError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function errorPayload(result: { structuredContent?: unknown; content?: unknown }): { code: string; message: string } {
  const structured = result.structuredContent as { code?: unknown; error?: unknown } | undefined;
  if (structured && typeof structured.error === 'string') {
    return { code: typeof structured.code === 'string' ? structured.code : 'error', message: structured.error };
  }
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content.find((block): block is { type: 'text'; text: string } => block?.type === 'text')?.text ?? '';
  try {
    const parsed = JSON.parse(text) as { code?: string; error?: string };
    if (parsed.error) return { code: parsed.code ?? 'error', message: parsed.error };
  } catch {
    // Plain-text error from the host or transport.
  }
  return { code: 'error', message: text || 'The canvas tool call failed.' };
}

/** Call a pulse-canvas server tool through the host and return its structured result. */
export async function callCanvasTool<T>(app: App, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await app.callServerTool({ name, arguments: args });
  if (result.isError) {
    const { code, message } = errorPayload(result);
    throw new ToolCallError(code, message);
  }
  return (result.structuredContent ?? {}) as T;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
