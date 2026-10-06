export interface AgentContextMcpAppSnapshot {
  serverName: string;
  toolName: string;
  resourceUri: string;
  title: string;
  snapshots: Array<{ source: 'tool-result' | 'model-context' | 'visible-ui'; text: string; capturedAt: number }>;
}

const MAX_CONTEXT_BYTES = 64 * 1024;
const MAX_TEXT_CHARS = 16_000;

export function mcpAppContextText(context: unknown): string {
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    throw new Error('MCP App context must be an object');
  }
  // Binary content is not a text snapshot. Do not copy base64 images into prompts.
  const value = context as { content?: unknown; structuredContent?: unknown };
  const texts = Array.isArray(value.content)
    ? value.content.flatMap(block => (
      block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string'
        ? [block.text] : []
    )) : [];
  const structured = value.structuredContent === undefined ? '' : JSON.stringify(value.structuredContent);
  const text = [...texts, structured].filter(Boolean).join('\n');
  if (new TextEncoder().encode(text).byteLength > MAX_CONTEXT_BYTES) {
    throw new Error('MCP App text context exceeds 64 KiB');
  }
  return text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}\n[context truncated]` : text;
}
