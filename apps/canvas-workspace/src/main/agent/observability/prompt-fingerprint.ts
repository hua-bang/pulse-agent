import { createHash } from 'crypto';
import { asSchema } from 'ai';

import type { AgentTracePromptFingerprint } from '../../../shared/agent-observability';

// Tool objects are long-lived (registered once per Engine), so each one's
// serialization is computed once rather than on every model call.
const serializedTools = new WeakMap<object, string>();

const shortHash = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 16);

const inputJsonSchema = (tool: Record<string, unknown>): unknown => {
  const schema = tool.inputSchema ?? tool.parameters;
  if (schema === undefined) return null;
  try {
    return asSchema(schema as Parameters<typeof asSchema>[0]).jsonSchema;
  } catch {
    return null;
  }
};

const serializeTool = (tool: unknown): string => {
  if (!tool || typeof tool !== 'object') return '';
  const cached = serializedTools.get(tool);
  if (cached !== undefined) return cached;
  const record = tool as Record<string, unknown>;
  const serialized = JSON.stringify({
    description: typeof record.description === 'string' ? record.description : '',
    schema: inputJsonSchema(record),
    deferred: record.defer_loading === true,
  });
  serializedTools.set(tool, serialized);
  return serialized;
};

/**
 * Fingerprint the system prompt and tool list in the order the request
 * carries them. A provider prompt cache can only hit when both are identical
 * to an earlier request, so comparing fingerprints across traces shows
 * whether a cache miss came from the prompt itself or from the provider.
 */
export function promptFingerprint(
  systemPrompt: unknown,
  tools: Record<string, unknown> | undefined,
): AgentTracePromptFingerprint {
  const system = typeof systemPrompt === 'string' ? systemPrompt : JSON.stringify(systemPrompt ?? '');
  const entries = Object.entries(tools ?? {}).map(([name, tool]) => `${name}\u0000${serializeTool(tool)}`);
  const toolText = entries.join('\u0001');
  const mcpEntries = entries.filter(entry => entry.startsWith('mcp_'));
  return {
    systemHash: shortHash(system),
    systemChars: system.length,
    toolsHash: shortHash(toolText),
    toolCount: entries.length,
    toolsChars: toolText.length,
    mcpToolCount: mcpEntries.length,
    mcpToolsChars: mcpEntries.reduce((total, entry) => total + entry.length, 0),
  };
}
