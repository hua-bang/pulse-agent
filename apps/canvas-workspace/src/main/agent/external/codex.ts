/**
 * Codex CLI adapter — runs one segment via headless `codex exec --json`,
 * prompt piped through stdin (the `-` positional). Session continuity uses
 * the `codex exec resume <sessionId>` subcommand.
 *
 * Codex's JSONL stream has shipped in two dialects (the protocol event form
 * `{msg:{type:'agent_message'...}}` and the newer thread-event form
 * `{type:'item.completed', item:{...}}`), and `--json` remains marked
 * experimental upstream — so this parser accepts BOTH and ignores anything
 * else. Sandbox/permissions: we pass no sandbox flags; the run obeys the
 * user's own Codex config for that machine (same posture as Claude Code).
 */

import type { ExternalSegmentRequest, ExternalSegmentResult } from './types';
import { runJsonlCli } from './spawn-jsonl';

export const codexCommand = (): string =>
  process.env.PULSE_CANVAS_CODEX_CMD?.trim() || 'codex';

export function buildCodexArgs(opts: { sessionId?: string }): string[] {
  // --skip-git-repo-check: a role's cwd is a user-chosen directory that may
  // not be a git repo; without the flag `codex exec` refuses to start.
  const base = ['--json', '--skip-git-repo-check', '-'];
  return opts.sessionId
    ? ['exec', 'resume', opts.sessionId, ...base]
    : ['exec', ...base];
}

export interface CodexStreamState {
  sessionId?: string;
  /** Once deltas appear, full agent messages are duplicates. */
  sawDelta: boolean;
  parts: string[];
  resultText?: string;
  errorMessage?: string;
}

export const createCodexStreamState = (): CodexStreamState => ({ sawDelta: false, parts: [] });

const pushText = (state: CodexStreamState, text: unknown, onText: (delta: string) => void): void => {
  if (typeof text !== 'string' || !text) return;
  state.parts.push(text);
  onText(text);
};

export function consumeCodexStreamLine(
  state: CodexStreamState,
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

  // Dialect A: protocol events `{id, msg:{type, ...}}`.
  const msg = event?.msg;
  if (msg && typeof msg.type === 'string') {
    switch (msg.type) {
      case 'session_configured':
        if (typeof msg.session_id === 'string' && msg.session_id) state.sessionId = msg.session_id;
        return;
      case 'agent_message_delta':
        state.sawDelta = true;
        pushText(state, msg.delta, onText);
        return;
      case 'agent_message':
        if (!state.sawDelta) pushText(state, msg.message, onText);
        return;
      case 'task_complete':
        if (typeof msg.last_agent_message === 'string' && msg.last_agent_message) {
          state.resultText = msg.last_agent_message;
        }
        return;
      case 'error':
        state.errorMessage = typeof msg.message === 'string' && msg.message ? msg.message : 'Codex run failed';
        return;
      default:
        return;
    }
  }

  // Dialect B: thread events `{type: 'thread.started' | 'item.completed' | ...}`.
  if (typeof event?.type !== 'string') return;
  if (event.type === 'thread.started') {
    const id = event.thread_id ?? event.session_id;
    if (typeof id === 'string' && id) state.sessionId = id;
    return;
  }
  if (event.type === 'item.completed') {
    const item = event.item;
    const kind = item?.item_type ?? item?.type;
    if (kind === 'agent_message' && !state.sawDelta) pushText(state, item?.text, onText);
    return;
  }
  if (event.type === 'turn.failed' || event.type === 'error') {
    const detail = event.error?.message ?? event.message;
    state.errorMessage = typeof detail === 'string' && detail ? detail : 'Codex run failed';
  }
}

export async function runCodexSegment(request: ExternalSegmentRequest): Promise<ExternalSegmentResult> {
  const command = codexCommand();
  const state = createCodexStreamState();

  const exit = await runJsonlCli({
    command,
    args: buildCodexArgs({ sessionId: request.sessionId }),
    cwd: request.cwd,
    prompt: request.prompt,
    abortSignal: request.abortSignal,
    timeoutMs: request.timeoutMs,
    onLine: (line) => consumeCodexStreamLine(state, line, request.onText),
  });

  if (state.errorMessage) throw new Error(state.errorMessage);
  const text = state.resultText ?? state.parts.join('');
  if (exit.code !== 0 && !text) {
    throw new Error(`"${command}" exited with code ${exit.code}: ${exit.stderrTail || 'no output'}`);
  }
  return { text, sessionId: state.sessionId };
}
