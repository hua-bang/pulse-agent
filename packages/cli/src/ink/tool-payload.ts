/** Pure probes over AI-SDK tool call/result payload shapes. */

export function getToolInput(toolCall: Record<string, unknown>): unknown {
  const input = (toolCall as { input?: unknown }).input;
  if (input !== undefined) {
    return input;
  }
  const args = (toolCall as { args?: unknown }).args;
  if (args !== undefined) {
    return args;
  }
  return undefined;
}

export function getToolCallId(payload: Record<string, unknown>): string | undefined {
  const callId = (payload as { toolCallId?: unknown }).toolCallId;
  return typeof callId === 'string' && callId ? callId : undefined;
}

export function getToolOutput(toolResult: Record<string, unknown>): unknown {
  const output = (toolResult as { output?: unknown }).output;
  if (output !== undefined) {
    return output;
  }
  const result = (toolResult as { result?: unknown }).result;
  if (result !== undefined) {
    return result;
  }
  return (toolResult as { content?: unknown }).content;
}

export function resolveToolName(payload: Record<string, unknown>): string {
  const name = (payload as { toolName?: unknown }).toolName
    ?? (payload as { name?: unknown }).name
    ?? (payload as { tool?: unknown }).tool
    ?? (payload as { title?: unknown }).title
    ?? (payload as { kind?: unknown }).kind;
  if (typeof name === 'string' && name.trim()) {
    return name;
  }
  const toolCallId = (payload as { toolCallId?: unknown }).toolCallId;
  if (typeof toolCallId === 'string' && toolCallId.trim()) {
    return toolCallId;
  }
  return 'tool';
}
