import { randomUUID } from 'crypto';
import type { McpAppContextSource, McpAppNodeContextTarget } from '../../shared/mcp-apps';

const MAX_CONTEXT_BYTES = 64 * 1024;
const MAX_TEXT_CHARS = 16_000;
const MAX_INSTANCES = 128;

interface ContextEntry {
  senderId: number;
  target: McpAppNodeContextTarget;
  snapshots: Partial<Record<McpAppContextSource, { text: string; updatedAt: number }>>;
}

function contextText(context: unknown): string {
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
  if (Buffer.byteLength(text, 'utf8') > MAX_CONTEXT_BYTES) {
    throw new Error('MCP App text context exceeds 64 KiB');
  }
  return text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}\n[context truncated]` : text;
}

const sameTarget = (a: McpAppNodeContextTarget, b: McpAppNodeContextTarget): boolean => (
  a.workspaceId === b.workspaceId && a.nodeId === b.nodeId
  && a.serverName === b.serverName && a.toolName === b.toolName && a.resourceUri === b.resourceUri
);

/** Volatile view state. A replacement mount invalidates the old mount's token. */
export class McpAppNodeContextStore {
  private entries = new Map<string, ContextEntry>();

  open(senderId: number, target: McpAppNodeContextTarget): string {
    for (const [token, entry] of this.entries) {
      if (entry.target.workspaceId === target.workspaceId && entry.target.nodeId === target.nodeId) {
        this.entries.delete(token);
      }
    }
    if (this.entries.size >= MAX_INSTANCES) throw new Error('Too many MCP App context instances');
    const token = randomUUID();
    this.entries.set(token, { senderId, target: { ...target }, snapshots: {} });
    return token;
  }

  update(senderId: number, token: string, source: McpAppContextSource, context: unknown): void {
    const entry = this.entries.get(token);
    if (!entry || entry.senderId !== senderId) throw new Error('MCP App context instance is expired');
    if (!['tool-result', 'model-context', 'visible-ui'].includes(source)) throw new Error('Invalid context source');
    const text = contextText(context);
    entry.snapshots[source] = { text, updatedAt: Date.now() };
  }

  close(senderId: number, token: string): void {
    if (this.entries.get(token)?.senderId === senderId) this.entries.delete(token);
  }

  clearSender(senderId: number): void {
    for (const [token, entry] of this.entries) {
      if (entry.senderId === senderId) this.entries.delete(token);
    }
  }

  read(target: McpAppNodeContextTarget): string | undefined {
    const entry = [...this.entries.values()].find(value => sameTarget(value.target, target));
    if (!entry) return undefined;
    return (['visible-ui', 'model-context', 'tool-result'] as const).flatMap(source => {
      const snapshot = entry.snapshots[source];
      if (!snapshot?.text) return [];
      return [`${source} (captured ${new Date(snapshot.updatedAt).toISOString()}):\n${snapshot.text}`];
    }).join('\n\n') || undefined;
  }
}

let store: McpAppNodeContextStore | undefined;
export const getMcpAppNodeContextStore = (): McpAppNodeContextStore => (
  store ??= new McpAppNodeContextStore()
);
