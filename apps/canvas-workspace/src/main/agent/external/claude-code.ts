/**
 * Claude Code CLI adapter — runs one segment via headless `claude -p` with
 * stream-json output, the prompt piped through stdin (avoids ARG_MAX on long
 * transcripts). Session continuity uses `--resume <sessionId>`; the id is
 * captured from the stream's init/result events.
 *
 * Permission posture: we pass NO permission flags, so the agent obeys the
 * user's own Claude Code settings for that cwd — this feature never escalates
 * beyond what the user's local agent config already allows.
 */

import type { ExternalSegmentRequest, ExternalSegmentResult } from './types';
import { runJsonlCli } from './spawn-jsonl';

export const claudeCodeCommand = (): string =>
  process.env.PULSE_CANVAS_CLAUDE_CODE_CMD?.trim() || 'claude';

export function buildClaudeCodeArgs(opts: { sessionId?: string }): string[] {
  // --verbose is required for stream-json in -p mode on some CLI versions;
  // partial messages give token-level deltas where the CLI supports them.
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];
  if (opts.sessionId) args.push('--resume', opts.sessionId);
  return args;
}

/** Mutable accumulator shared across stream lines of one run. */
export interface ClaudeStreamState {
  sessionId?: string;
  /** Once token-level partials appear, full assistant texts are duplicates. */
  sawPartial: boolean;
  parts: string[];
  resultText?: string;
  errorMessage?: string;
}

export const createClaudeStreamState = (): ClaudeStreamState => ({ sawPartial: false, parts: [] });

/**
 * Consume one stream-json line. Tolerant by design: unknown event types are
 * ignored so CLI version drift degrades to coarser streaming, not a crash
 * (the real 2.1.220 stream already carries kinds we don't model).
 */
export function consumeClaudeStreamLine(
  state: ClaudeStreamState,
  line: string,
  onText: (delta: string) => void,
): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  let event: any;
  try {
    event = JSON.parse(trimmed);
  } catch {
    return;
  }

  if (typeof event?.session_id === 'string' && event.session_id) {
    state.sessionId = event.session_id;
  }

  if (event?.type === 'stream_event') {
    const delta = event.event?.delta;
    if (delta?.type === 'text_delta' && typeof delta.text === 'string' && delta.text) {
      state.sawPartial = true;
      state.parts.push(delta.text);
      onText(delta.text);
    }
    return;
  }

  if (event?.type === 'assistant' && !state.sawPartial) {
    const content = event.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block?.type === 'text' && typeof block.text === 'string' && block.text) {
          state.parts.push(block.text);
          onText(block.text);
        }
      }
    }
    return;
  }

  if (event?.type === 'result') {
    if (typeof event.result === 'string' && event.result) {
      state.resultText = event.result;
    }
    if (event.is_error || (typeof event.subtype === 'string' && event.subtype.startsWith('error'))) {
      state.errorMessage = typeof event.result === 'string' && event.result
        ? event.result
        : `Claude Code run failed (${event.subtype ?? 'error'})`;
    }
  }
}

export async function runClaudeCodeSegment(request: ExternalSegmentRequest): Promise<ExternalSegmentResult> {
  const command = claudeCodeCommand();
  const state = createClaudeStreamState();

  const exit = await runJsonlCli({
    command,
    args: buildClaudeCodeArgs({ sessionId: request.sessionId }),
    cwd: request.cwd,
    prompt: request.prompt,
    abortSignal: request.abortSignal,
    timeoutMs: request.timeoutMs,
    onLine: (line) => consumeClaudeStreamLine(state, line, request.onText),
  });

  if (state.errorMessage) throw new Error(state.errorMessage);
  const text = state.resultText ?? state.parts.join('');
  if (exit.code !== 0 && !text) {
    throw new Error(`"${command}" exited with code ${exit.code}: ${exit.stderrTail || 'no output'}`);
  }
  return { text, sessionId: state.sessionId };
}
