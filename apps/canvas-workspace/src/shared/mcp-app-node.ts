import type { McpAppEntrypointKind, McpAppEntrypointListing } from './mcp-apps';

/**
 * Canvas nodes that host an MCP App opened from a static entrypoint. They use
 * the generic `plugin` node shell; the payload is the host-owned instance
 * binding, never the app's own state.
 */
export const MCP_APP_NODE_PLUGIN_ID = 'mcp-apps';
export const MCP_APP_NODE_TYPE = 'mcp-app';
export const MCP_APP_NODE_DEFAULT_SIZE = { width: 720, height: 520 } as const;

export interface McpAppNodeBinding {
  serverName: string;
  toolName: string;
  resourceUri: string;
  title: string;
  kind: McpAppEntrypointKind;
  /** Pulse node type declared by a `pulse/ui` node entrypoint. */
  entryNodeType?: string;
}

const KINDS: McpAppEntrypointKind[] = ['node', 'global', 'thread'];

const text = (value: unknown): string | undefined => (
  typeof value === 'string' && value.trim() ? value.trim() : undefined
);

export function parseMcpAppNodeBinding(payload: unknown): McpAppNodeBinding | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const record = payload as Record<string, unknown>;
  const serverName = text(record.serverName);
  const toolName = text(record.toolName);
  const resourceUri = text(record.resourceUri);
  if (!serverName || !toolName || !resourceUri?.startsWith('ui://')) return undefined;
  const kind = KINDS.includes(record.kind as McpAppEntrypointKind)
    ? record.kind as McpAppEntrypointKind
    : 'global';
  const entryNodeType = text(record.entryNodeType);
  return {
    serverName,
    toolName,
    resourceUri,
    title: text(record.title) ?? toolName,
    kind,
    ...(entryNodeType ? { entryNodeType } : {}),
  };
}

export function mcpAppNodeBindingFromListing(listing: McpAppEntrypointListing): McpAppNodeBinding {
  return {
    serverName: listing.serverName,
    toolName: listing.toolName,
    resourceUri: listing.resourceUri,
    title: listing.title,
    kind: listing.kind,
    ...(listing.nodeType ? { entryNodeType: listing.nodeType } : {}),
  };
}
