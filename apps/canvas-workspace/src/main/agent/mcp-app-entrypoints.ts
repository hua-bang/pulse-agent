import type { MCPAppEntrypoint, MCPAppToolDescriptor } from 'pulse-coder-engine/built-in';
import type {
  McpAppEntrypointKind,
  McpAppEntrypointListing,
} from '../../shared/mcp-apps';

const KIND_PRIORITY: Array<{ namespace: string; kind: McpAppEntrypointKind }> = [
  { namespace: 'pulse/ui', kind: 'node' },
  { namespace: 'openai/ui', kind: 'global' },
  { namespace: 'openai/ui', kind: 'thread' },
];

const MIN_NODE_SIZE = 200;
const MAX_NODE_SIZE = 2_000;

function pickEntrypoint(entrypoints: MCPAppEntrypoint[] = []) {
  for (const candidate of KIND_PRIORITY) {
    const match = entrypoints.find(entry => (
      entry.namespace === candidate.namespace && entry.type === candidate.kind
    ));
    if (match) return { kind: candidate.kind, entry: match };
  }
  return undefined;
}

function optionalString(value: unknown, maxLength: number): string | undefined {
  return typeof value === 'string' && value.trim() && value.length <= maxLength
    ? value.trim()
    : undefined;
}

function nodeSize(value: unknown): McpAppEntrypointListing['defaultSize'] {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const [width, height] = value;
  if (typeof width !== 'number' || typeof height !== 'number') return undefined;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined;
  const clamp = (size: number) => Math.round(Math.min(MAX_NODE_SIZE, Math.max(MIN_NODE_SIZE, size)));
  return { width: clamp(width), height: clamp(height) };
}

/** Resolve one openable entrypoint per MCP App tool, preferring Pulse `node`. */
export function toMcpAppEntrypointListing(
  app: MCPAppToolDescriptor,
): McpAppEntrypointListing | undefined {
  const picked = pickEntrypoint(app.entrypoints);
  if (!picked) return undefined;
  const { options } = picked.entry;
  const nodeType = picked.kind === 'node' ? optionalString(options.nodeType, 128) : undefined;
  const defaultSize = picked.kind === 'node' ? nodeSize(options.defaultSize) : undefined;
  return {
    serverName: app.serverName,
    toolName: app.toolName,
    resourceUri: app.resourceUri,
    title: (picked.kind === 'node' ? optionalString(options.title, 120) : undefined)
      ?? app.title
      ?? app.toolName,
    kind: picked.kind,
    ...(nodeType ? { nodeType } : {}),
    ...(defaultSize ? { defaultSize } : {}),
  };
}

export function listMcpAppEntrypoints(apps: MCPAppToolDescriptor[]): McpAppEntrypointListing[] {
  const listings = apps
    .map(toMcpAppEntrypointListing)
    .filter((listing): listing is McpAppEntrypointListing => Boolean(listing));
  // An OpenAI thread entrypoint is the side-panel variant of the same app; on
  // the canvas both open as identical nodes, so keep only the global one.
  const globalApps = new Set(listings
    .filter(listing => listing.kind === 'global')
    .map(listing => `${listing.serverName}\n${listing.resourceUri}`));
  return listings.filter(listing => (
    listing.kind !== 'thread' || !globalApps.has(`${listing.serverName}\n${listing.resourceUri}`)
  ));
}
