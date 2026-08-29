export const MCP_APP_TOOL_ARGUMENT_LIMIT = 4_000;

export function serializeMcpAppToolArguments(value: unknown): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(value ?? {}, null, 2);
  } catch {
    throw new Error('Tool arguments must be JSON serializable');
  }
  if (serialized.length > MCP_APP_TOOL_ARGUMENT_LIMIT) {
    throw new Error(`Tool arguments exceed the ${MCP_APP_TOOL_ARGUMENT_LIMIT}-character approval limit`);
  }
  return serialized;
}
