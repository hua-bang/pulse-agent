/**
 * Engine-run stream plumbing shared by every chat segment: AI-SDK output
 * unwrapping, tool-call frame extraction for session persistence, and the
 * engine.run callback adapters (logging + debug-trace recording). Extracted
 * from canvas-agent.ts so the relay loop fits inside its file-size baseline.
 */

import type { ModelMessage } from 'ai';
import type { CanvasAgentDebugTrace, CanvasAgentToolCall } from './types';
import { recordTraceToolCall, recordTraceToolResult } from './debug-trace';

// AI SDK v6 wraps tool execute return values into a tagged `ToolResultOutput`
// — `{ type: 'text'|'json'|'error-text'|'error-json'|..., value }` — on the
// `tool-result` parts of persisted ModelMessages. Stringifying the wrapper
// loses the original payload (renderers can no longer JSON.parse the
// tool's actual return value), so unwrap to the inner value first. Plain
// strings and untyped objects pass through unchanged for back-compat.
export function unwrapToolOutput(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object') {
    const r = raw as { type?: unknown; value?: unknown };
    if (typeof r.type === 'string' && 'value' in r) {
      const v = r.value;
      if (typeof v === 'string') return v;
      return JSON.stringify(v) ?? String(v);
    }
  }
  return JSON.stringify(raw) ?? String(raw);
}

export function modelMessagesToToolCalls(messages: ModelMessage[]): CanvasAgentToolCall[] {
  const toolCalls: CanvasAgentToolCall[] = [];
  const byToolCallId = new Map<string, CanvasAgentToolCall>();
  const findOrCreate = (toolCallId: string, name: string): CanvasAgentToolCall => {
    const existing = byToolCallId.get(toolCallId);
    if (existing) {
      if (!existing.name && name) existing.name = name;
      return existing;
    }
    const tool: CanvasAgentToolCall = {
      id: toolCalls.length + 1,
      name,
      toolCallId,
      status: 'running',
    };
    toolCalls.push(tool);
    byToolCallId.set(toolCallId, tool);
    return tool;
  };
  for (const message of messages) {
    const content = (message as any).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part?.type === 'tool-call') {
        const toolCallId = typeof part.toolCallId === 'string' ? part.toolCallId : undefined;
        const name = typeof part.toolName === 'string' ? part.toolName : '';
        if (!toolCallId || !name) continue;
        const tool = findOrCreate(toolCallId, name);
        tool.name = name;
        tool.args = part.input ?? part.args;
      }

      if (part?.type === 'tool-result') {
        const toolCallId = typeof part.toolCallId === 'string' ? part.toolCallId : undefined;
        const name = typeof part.toolName === 'string' ? part.toolName : '';
        if (!toolCallId || !name) continue;
        const tool = findOrCreate(toolCallId, name);
        tool.name = name;
        tool.status = 'done';
        tool.result = unwrapToolOutput(part.output ?? part.result);
      }
    }
  }
  return toolCalls;
}

export interface EngineStreamCallbacks {
  onText?: (delta: string) => void;
  onToolCall?: (data: { name: string; args: any; toolCallId?: string }) => void;
  onToolResult?: (data: { name: string; result: string; toolCallId?: string }) => void;
  onToolInputStart?: (data: { id: string; toolName: string }) => void;
  onToolInputDelta?: (data: { id: string; delta: string }) => void;
  onToolInputEnd?: (data: { id: string }) => void;
}

/**
 * Adapt the renderer-facing stream callbacks into engine.run's chunk
 * callbacks, recording the debug trace along the way. Chunk field fallbacks
 * cover AI SDK v6 (`input`/`output`) and older versions (`args`/`result`).
 */
export function buildEngineStreamCallbacks(
  callbacks: EngineStreamCallbacks,
  debugTrace: CanvasAgentDebugTrace | undefined,
) {
  const { onText, onToolCall, onToolResult, onToolInputStart, onToolInputDelta, onToolInputEnd } = callbacks;
  return {
    onText,
    onToolCall: (onToolCall || debugTrace)
      ? (chunk: any) => {
          const args = chunk.input ?? chunk.args;
          console.info('[canvas-agent] tool-call chunk keys:', Object.keys(chunk), 'input:', chunk.input, 'args:', chunk.args);
          recordTraceToolCall(debugTrace, { name: chunk.toolName, args, toolCallId: chunk.toolCallId });
          onToolCall?.({ name: chunk.toolName, args, toolCallId: chunk.toolCallId });
        }
      : undefined,
    onToolResult: (onToolResult || debugTrace)
      ? (chunk: any) => {
          const raw = chunk.output ?? chunk.result;
          console.info('[canvas-agent] tool-result chunk keys:', Object.keys(chunk), 'output:', typeof chunk.output, 'result:', typeof chunk.result);
          recordTraceToolResult(debugTrace, { name: chunk.toolName, rawResult: raw, toolCallId: chunk.toolCallId });
          onToolResult?.({
            name: chunk.toolName,
            result: unwrapToolOutput(raw),
            toolCallId: chunk.toolCallId,
          });
        }
      : undefined,
    onToolInputStart: onToolInputStart
      ? (chunk: { id: string; toolName: string }) => {
          console.info('[canvas-agent] tool-input-start', chunk.toolName, chunk.id);
          onToolInputStart(chunk);
        }
      : undefined,
    onToolInputDelta: onToolInputDelta
      ? (chunk: { id: string; delta: string }) => {
          // Sample log — full delta firehose is too noisy for a long run.
          if (Math.random() < 0.02) {
            console.info('[canvas-agent] tool-input-delta (sampled)', chunk.id, chunk.delta.length + 'B');
          }
          onToolInputDelta(chunk);
        }
      : undefined,
    onToolInputEnd: onToolInputEnd
      ? (chunk: { id: string }) => {
          console.info('[canvas-agent] tool-input-end', chunk.id);
          onToolInputEnd(chunk);
        }
      : undefined,
  };
}
