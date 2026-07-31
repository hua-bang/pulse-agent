/**
 * Tool-activity plumbing shared by the CLI adapters. An external agent spends
 * most of a segment reading files and running commands; without these events
 * the chat sits silent for the whole run. Both adapters translate their own
 * event vocabulary into the SAME shape the engine path emits, so external
 * segments grow the same tool chips as built-in ones.
 *
 * Robustness rule: a result whose call was never seen (dialect drift, a
 * begin event we do not model) still emits a call first — a chip with an
 * unknown name beats a silent gap.
 */

const TOOL_RESULT_MAX_CHARS = 4000;

export interface ExternalStreamHandlers {
  onText: (delta: string) => void;
  onToolCall?: (event: { name: string; args: unknown; toolCallId: string }) => void;
  onToolResult?: (event: CanvasToolResultEvent) => void;
}

/** id → tool name, so a result event can carry the name its begin event had. */
export type ToolNameMap = Map<string, string>;

export interface ExternalToolOutcome {
  status?: CanvasToolResultEvent['status'];
  error?: string;
}

export function startTool(
  names: ToolNameMap,
  handlers: ExternalStreamHandlers,
  id: string | undefined,
  name: string,
  args: unknown,
): void {
  if (!id || names.has(id)) return;
  names.set(id, name);
  handlers.onToolCall?.({ name, args, toolCallId: id });
}

export function finishTool(
  names: ToolNameMap,
  handlers: ExternalStreamHandlers,
  id: string | undefined,
  result: string,
  fallbackName = 'tool',
  outcome: ExternalToolOutcome = {},
): void {
  if (!id) return;
  startTool(names, handlers, id, fallbackName, undefined);
  const normalizedResult = truncateToolResult(result);
  const status = outcome.status ?? 'succeeded';
  handlers.onToolResult?.({
    name: names.get(id) ?? fallbackName,
    result: normalizedResult,
    toolCallId: id,
    status,
    error: outcome.error
      ? truncateToolResult(outcome.error)
      : status === 'failed'
        ? normalizedResult || 'Tool execution failed'
        : status === 'cancelled'
          ? normalizedResult || 'Tool execution cancelled'
          : undefined,
  });
}

export function truncateToolResult(value: string): string {
  return value.length > TOOL_RESULT_MAX_CHARS
    ? `${value.slice(0, TOOL_RESULT_MAX_CHARS)}\n…(truncated)`
    : value;
}

/** Claude tool_result content is a string or a block array; flatten either. */
export function flattenResultContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(block => (block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string'
        ? (block as { text: string }).text
        : ''))
      .filter(Boolean)
      .join('\n');
  }
  return content === undefined || content === null ? '' : JSON.stringify(content);
}
import type { CanvasToolResultEvent } from '../engine-stream-callbacks';
