/**
 * Engine-run stream plumbing shared by every chat segment: AI-SDK output
 * unwrapping, tool-call frame extraction for session persistence, and the
 * engine.run callback adapters (logging + debug-trace recording). Extracted
 * from canvas-agent.ts so the relay loop fits inside its file-size baseline.
 */

import type { ModelMessage } from 'ai';
import type { CanvasAgentDebugTrace, CanvasAgentToolCall } from './types';
import { recordTraceStreamEvent, recordTraceToolCall, recordTraceToolResult } from './debug-trace';

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

export interface CanvasToolResultEvent {
  name: string;
  result: string;
  toolCallId?: string;
  status: 'succeeded' | 'failed' | 'cancelled';
  error?: string;
}

/**
 * Preserve the AI SDK's error result variants and common structured tool
 * failures. The previous string-only bridge erased this distinction and the
 * renderer consequently showed every terminal tool as a successful checkmark.
 */
export function normalizeToolResult(
  raw: unknown,
  meta: { name: string; toolCallId?: string },
): CanvasToolResultEvent {
  const result = unwrapToolOutput(raw);
  let failed = false;
  let cancelled = false;
  let error: string | undefined;

  if (raw && typeof raw === 'object') {
    const wrapper = raw as {
      type?: unknown;
      value?: unknown;
      error?: unknown;
      ok?: unknown;
      cancelled?: unknown;
      exitCode?: unknown;
    };
    failed = typeof wrapper.type === 'string' && wrapper.type.startsWith('error-');
    const value = (
      typeof wrapper.type === 'string' && 'value' in wrapper
        ? wrapper.value
        : raw
    ) as { ok?: unknown; cancelled?: unknown; error?: unknown; exitCode?: unknown } | unknown;
    if (value && typeof value === 'object') {
      const record = value as { ok?: unknown; cancelled?: unknown; error?: unknown; exitCode?: unknown };
      cancelled = record.cancelled === true;
      failed ||= record.ok === false;
      failed ||= typeof record.exitCode === 'number' && record.exitCode !== 0;
      if (typeof record.error === 'string' && record.error.trim()) {
        error = record.error.trim();
        failed = true;
      }
    }
    if (!error && typeof wrapper.error === 'string' && wrapper.error.trim()) {
      error = wrapper.error.trim();
      failed = true;
    }
  }

  if (!failed && /^\s*(?:error|failed|failure)\s*:/i.test(result)) {
    failed = true;
  }
  if ((failed || cancelled) && !error) {
    error = result || (cancelled ? 'Tool execution cancelled' : 'Tool execution failed');
  }

  return {
    ...meta,
    result,
    status: cancelled ? 'cancelled' : failed ? 'failed' : 'succeeded',
    error,
  };
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
        const outcome = normalizeToolResult(part.output ?? part.result, { name, toolCallId });
        tool.name = name;
        tool.status = outcome.status;
        tool.result = outcome.result;
        tool.error = outcome.error;
      }
    }
  }
  return toolCalls;
}

export interface EngineStreamCallbacks {
  onText?: (delta: string) => void;
  onToolCall?: (data: { name: string; args: any; toolCallId?: string }) => void;
  onToolResult?: (data: CanvasToolResultEvent) => void;
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
          recordTraceStreamEvent(debugTrace, 'tool-call');
          const args = chunk.input ?? chunk.args;
          console.info('[canvas-agent] tool-call chunk keys:', Object.keys(chunk), 'input:', chunk.input, 'args:', chunk.args);
          recordTraceToolCall(debugTrace, { name: chunk.toolName, args, toolCallId: chunk.toolCallId });
          onToolCall?.({ name: chunk.toolName, args, toolCallId: chunk.toolCallId });
        }
      : undefined,
    onToolResult: (onToolResult || debugTrace)
      ? (chunk: any) => {
          recordTraceStreamEvent(debugTrace, 'tool-result');
          const raw = chunk.output ?? chunk.result;
          const outcome = normalizeToolResult(raw, {
            name: chunk.toolName,
            toolCallId: chunk.toolCallId,
          });
          console.info('[canvas-agent] tool-result chunk keys:', Object.keys(chunk), 'output:', typeof chunk.output, 'result:', typeof chunk.result);
          recordTraceToolResult(debugTrace, { name: chunk.toolName, rawResult: raw, toolCallId: chunk.toolCallId });
          onToolResult?.(outcome);
        }
      : undefined,
    onToolInputStart: onToolInputStart
      ? (chunk: { id: string; toolName: string }) => {
          recordTraceStreamEvent(debugTrace, 'tool-input');
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
