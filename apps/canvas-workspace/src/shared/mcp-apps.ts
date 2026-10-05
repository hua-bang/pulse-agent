export const MCP_APP_TOOL_ARGUMENT_LIMIT = 16 * 1024 * 1024;
export const MCP_APP_TOOL_ARGUMENT_PREVIEW_LIMIT = 4_000;

export type McpAppContextSource = 'tool-result' | 'model-context' | 'visible-ui';

export interface McpAppNodeContextTarget {
  workspaceId: string;
  nodeId: string;
  serverName: string;
  toolName: string;
  resourceUri: string;
}

export interface McpAppNodeContextApi {
  openNodeContext(target: McpAppNodeContextTarget): Promise<{
    ok: boolean; token?: string; error?: string; code?: 'node-not-persisted';
  }>;
  updateNodeContext(token: string, source: McpAppContextSource, context: unknown): Promise<{ ok: boolean; error?: string }>;
  closeNodeContext(token: string): Promise<{ ok: boolean; error?: string }>;
}

export type McpAppToolApprovalDecision = 'once' | 'session' | 'cancel';

export interface McpAppToolApprovalRequest {
  requestId: string;
  serverName: string;
  toolName: string;
  argumentsPreview: string;
  argumentsSize: number;
  truncated: boolean;
}

export interface McpAppToolCallResponse {
  ok: boolean;
  value?: unknown;
  error?: string;
  approval?: McpAppToolApprovalRequest;
}

export interface McpAppToolApprovalResponse {
  requestId: string;
  decision: McpAppToolApprovalDecision;
}

export interface SerializedMcpAppToolArguments {
  serialized: string;
  preview: string;
  size: number;
  truncated: boolean;
}

export function serializeMcpAppToolArguments(value: unknown): SerializedMcpAppToolArguments {
  let serialized: string;
  let formatted: string;
  try {
    serialized = JSON.stringify(value ?? {});
    formatted = JSON.stringify(value ?? {}, null, 2);
  } catch {
    throw new Error('Tool arguments must be JSON serializable');
  }
  if (serialized === undefined || formatted === undefined) {
    throw new Error('Tool arguments must be JSON serializable');
  }
  const size = new TextEncoder().encode(serialized).byteLength;
  if (size > MCP_APP_TOOL_ARGUMENT_LIMIT) {
    throw new Error('Tool arguments exceed the 16 MiB host limit');
  }
  const truncated = formatted.length > MCP_APP_TOOL_ARGUMENT_PREVIEW_LIMIT;
  return {
    serialized,
    preview: truncated
      ? `${formatted.slice(0, MCP_APP_TOOL_ARGUMENT_PREVIEW_LIMIT)}\n…`
      : formatted,
    size,
    truncated,
  };
}

/**
 * Static entrypoints Pulse can open without a model tool call. `node` comes
 * from `_meta["pulse/ui"]`; `global` and `thread` are OpenAI entrypoints that
 * Pulse opens as canvas nodes without per-instance state.
 */
export type McpAppEntrypointKind = 'node' | 'global' | 'thread';

/**
 * A host-checked app icon, always a base64 data URI. SVG renders as a mask
 * filled with the current text color (OpenAI asks for monochrome
 * `currentColor` icons); raster images render as they are.
 */
export interface McpAppIconImage {
  src: string;
  kind: 'mask' | 'image';
}

/** `dark` replaces `default` while the dark theme is active. */
export interface McpAppIconSet {
  default: McpAppIconImage;
  dark?: McpAppIconImage;
}

export interface McpAppEntrypointListing {
  serverName: string;
  toolName: string;
  resourceUri: string;
  title: string;
  kind: McpAppEntrypointKind;
  /** Pulse node type declared by a `node` entrypoint. */
  nodeType?: string;
  defaultSize?: { width: number; height: number };
  /** The tool's MCP icon, validated and inlined by the main process. */
  icon?: McpAppIconSet;
}

export interface McpAppEntrypointOpenResult {
  ok: boolean;
  /** Full MCP tools/call result envelope for the `{}` entrypoint call. */
  value?: unknown;
  error?: string;
}
