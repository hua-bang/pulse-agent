/**
 * pi CLI adapter (earendil-works `@earendil-works/pi-coding-agent`) — runs
 * one segment via headless `pi --mode json -p`, the prompt piped through
 * stdin (same ARG_MAX posture as the Claude Code adapter). The JSONL event
 * vocabulary is pi's AgentSessionEvent stream (docs/json.md in the pi
 * package): a `session` header line first, then `message_update` deltas and
 * `tool_execution_start/end` events. Session continuity uses
 * `--session <id>`; a fresh run announces its id in that FIRST header line.
 *
 * Permission posture: pi ships no permission system by design (containment
 * is the environment's job in its philosophy), so like the other adapters we
 * pass no permission flags — the run obeys the user's own pi settings,
 * extensions, and project-trust decisions for that cwd, and never escalates
 * beyond what the user's local agent config already allows.
 */

import type { ExternalSegmentRequest, ExternalSegmentResult } from './types';
import { runJsonlCli } from './spawn-jsonl';
import {
  finishTool,
  flattenResultContent,
  startTool,
  type ExternalStreamHandlers,
  type ToolNameMap,
} from './tool-events';

export const piCommand = (): string =>
  process.env.PULSE_CANVAS_PI_CMD?.trim() || 'pi';

export function buildPiArgs(opts: { sessionId?: string }): string[] {
  const args = ['--mode', 'json', '-p'];
  if (opts.sessionId) args.push('--session', opts.sessionId);
  return args;
}

/** Mutable accumulator shared across stream lines of one run. */
export interface PiStreamState {
  sessionId?: string;
  /** Once token-level deltas appear, message_end texts are duplicates
   *  for STREAMING purposes (they stay authoritative for the result). */
  sawDelta: boolean;
  parts: string[];
  /** Text of the last completed assistant message — the segment's reply. */
  finalText?: string;
  errorMessage?: string;
  toolNames: ToolNameMap;
}

export const createPiStreamState = (): PiStreamState => ({
  sawDelta: false, parts: [], toolNames: new Map(),
});

const assistantMessageText = (message: any): string => {
  const content = message?.content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block: any) => (block?.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .filter(Boolean)
    .join('');
};

/**
 * Consume one `--mode json` line. Tolerant by design: unknown event types
 * (queue_update, compaction_*, auto_retry_*, thinking deltas, …) are ignored
 * so pi version drift degrades to coarser streaming, not a crash.
 */
export function consumePiStreamLine(
  state: PiStreamState,
  line: string,
  handlers: ExternalStreamHandlers,
): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  let event: any;
  try {
    event = JSON.parse(trimmed);
  } catch {
    return;
  }

  // First line of every run: {"type":"session","id":"<uuid>",...}.
  if (event?.type === 'session' && typeof event.id === 'string' && event.id) {
    state.sessionId = event.id;
    return;
  }

  if (event?.type === 'message_update') {
    const delta = event.assistantMessageEvent;
    if (delta?.type === 'text_delta' && typeof delta.delta === 'string' && delta.delta) {
      state.sawDelta = true;
      state.parts.push(delta.delta);
      handlers.onText(delta.delta);
    }
    return;
  }

  if (event?.type === 'message_end') {
    const message = event.message;
    if (message?.role !== 'assistant') return;
    if (message.stopReason === 'error') {
      state.errorMessage = typeof message.errorMessage === 'string' && message.errorMessage
        ? message.errorMessage
        : 'pi run failed';
      return;
    }
    const text = assistantMessageText(message);
    if (!text) return;
    if (!state.sawDelta) {
      state.parts.push(text);
      handlers.onText(text);
    }
    state.finalText = text;
    return;
  }

  if (event?.type === 'tool_execution_start') {
    startTool(
      state.toolNames,
      handlers,
      typeof event.toolCallId === 'string' ? event.toolCallId : undefined,
      String(event.toolName ?? 'tool'),
      event.args,
    );
    return;
  }

  if (event?.type === 'tool_execution_end') {
    const result = typeof event.result === 'string'
      ? event.result
      : flattenResultContent(event.result?.content ?? event.result);
    finishTool(
      state.toolNames,
      handlers,
      typeof event.toolCallId === 'string' ? event.toolCallId : undefined,
      result,
      'tool',
      event.isError ? { status: 'failed', error: result } : undefined,
    );
  }
}

export async function runPiSegment(request: ExternalSegmentRequest): Promise<ExternalSegmentResult> {
  const command = piCommand();
  const state = createPiStreamState();

  const exit = await runJsonlCli({
    command,
    args: buildPiArgs({ sessionId: request.sessionId }),
    cwd: request.cwd,
    prompt: request.prompt,
    abortSignal: request.abortSignal,
    timeoutMs: request.timeoutMs,
    onLine: (line) => consumePiStreamLine(state, line, request),
  });

  if (state.errorMessage) throw new Error(state.errorMessage);
  const text = state.finalText ?? state.parts.join('');
  if (exit.code !== 0 && !text) {
    throw new Error(`"${command}" exited with code ${exit.code}: ${exit.stderrTail || 'no output'}`);
  }
  return { text, sessionId: state.sessionId };
}
