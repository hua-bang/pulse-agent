export const MCP_APP_TOOL_ARGUMENT_LIMIT = 16 * 1024 * 1024;
export const MCP_APP_TOOL_ARGUMENT_PREVIEW_LIMIT = 4_000;

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
