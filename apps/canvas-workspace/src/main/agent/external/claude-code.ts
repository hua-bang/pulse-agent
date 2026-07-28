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

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import type { ExternalSegmentRequest, ExternalSegmentResult } from './types';

export const EXTERNAL_SEGMENT_TIMEOUT_MS = 10 * 60_000;

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
 * ignored so CLI version drift degrades to coarser streaming, not a crash.
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
  const args = buildClaudeCodeArgs({ sessionId: request.sessionId });
  const timeoutMs = request.timeoutMs ?? EXTERNAL_SEGMENT_TIMEOUT_MS;

  // A missing cwd makes spawn fail with a misleading ENOENT on the COMMAND;
  // surface the actual misconfiguration instead.
  if (!existsSync(request.cwd)) {
    throw new Error(`External role working directory does not exist: ${request.cwd}`);
  }

  return await new Promise<ExternalSegmentResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: request.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    const state = createClaudeStreamState();
    let stdoutRest = '';
    const stderrTail: string[] = [];
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.abortSignal.removeEventListener('abort', onAbort);
      fn();
    };
    const fail = (message: string) => settle(() => reject(new Error(message)));

    const killChild = () => {
      child.kill('SIGTERM');
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 2000).unref();
    };
    const onAbort = () => { killChild(); fail('External agent run aborted'); };
    const timer = setTimeout(() => { killChild(); fail(`External agent run timed out after ${Math.round(timeoutMs / 1000)}s`); }, timeoutMs);
    timer.unref();

    if (request.abortSignal.aborted) { onAbort(); return; }
    request.abortSignal.addEventListener('abort', onAbort);

    child.on('error', (err) => fail(`Failed to launch "${command}": ${err.message}`));

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdoutRest += chunk;
      let newlineIndex = stdoutRest.indexOf('\n');
      while (newlineIndex >= 0) {
        consumeClaudeStreamLine(state, stdoutRest.slice(0, newlineIndex), request.onText);
        stdoutRest = stdoutRest.slice(newlineIndex + 1);
        newlineIndex = stdoutRest.indexOf('\n');
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderrTail.push(chunk);
      if (stderrTail.length > 20) stderrTail.shift();
    });

    child.on('close', (code) => {
      consumeClaudeStreamLine(state, stdoutRest, request.onText);
      if (state.errorMessage) { fail(state.errorMessage); return; }
      const text = state.resultText ?? state.parts.join('');
      if (code !== 0 && !text) {
        fail(`"${command}" exited with code ${code}: ${stderrTail.join('').trim().slice(-400) || 'no output'}`);
        return;
      }
      settle(() => resolve({ text, sessionId: state.sessionId }));
    });

    child.stdin.write(request.prompt);
    child.stdin.end();
  });
}
