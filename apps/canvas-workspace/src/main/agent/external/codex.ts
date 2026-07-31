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
import {
  finishTool,
  startTool,
  type ExternalStreamHandlers,
  type ExternalToolOutcome,
  type ToolNameMap,
} from './tool-events';

/** Codex tool vocabulary → (chip name, args) / result text, per dialect-A msg type. */
const TOOL_BEGIN: Record<string, (msg: any) => { name: string; args: unknown }> = {
  exec_command_begin: msg => ({
    name: 'Bash',
    args: { command: Array.isArray(msg.command) ? msg.command.join(' ') : msg.command, cwd: msg.cwd },
  }),
  patch_apply_begin: msg => ({ name: 'ApplyPatch', args: { files: Object.keys(msg.changes ?? {}) } }),
  mcp_tool_call_begin: msg => ({
    name: `${msg.invocation?.server ?? 'mcp'}:${msg.invocation?.tool ?? 'tool'}`,
    args: msg.invocation?.arguments,
  }),
  web_search_begin: msg => ({ name: 'WebSearch', args: { query: msg.query } }),
};

interface ToolEnd {
  result: string;
  outcome?: ExternalToolOutcome;
}

const failedOutcome = (result: string): ExternalToolOutcome => ({
  status: 'failed',
  error: result || 'Tool execution failed',
});

const TOOL_END: Record<string, (msg: any) => ToolEnd> = {
  exec_command_end: (msg) => {
    const result = String(msg.aggregated_output ?? msg.stdout ?? msg.stderr ?? `exit ${msg.exit_code}`);
    return {
      result,
      outcome: typeof msg.exit_code === 'number' && msg.exit_code !== 0
        ? failedOutcome(result)
        : undefined,
    };
  },
  patch_apply_end: (msg) => {
    const result = msg.success === false ? String(msg.stderr ?? 'Patch failed') : 'applied';
    return { result, outcome: msg.success === false ? failedOutcome(result) : undefined };
  },
  mcp_tool_call_end: (msg) => {
    const result = JSON.stringify(msg.result ?? msg.error ?? {});
    const failed = Boolean(msg.error || msg.is_error || msg.result?.is_error);
    return { result, outcome: failed ? failedOutcome(result) : undefined };
  },
  web_search_end: msg => ({ result: String(msg.query ?? 'done') }),
};

/** Dialect-B item kinds that represent tool activity rather than speech. */
const ITEM_TOOL_NAMES: Record<string, string> = {
  command_execution: 'Bash',
  file_change: 'ApplyPatch',
  mcp_tool_call: 'McpTool',
  web_search: 'WebSearch',
};

const itemResultText = (item: any): string =>
  String(item?.aggregated_output ?? item?.output ?? item?.result ?? item?.status ?? 'done');

const itemOutcome = (item: any, result: string): ExternalToolOutcome | undefined => {
  const status = String(item?.status ?? '').toLowerCase();
  if (status === 'cancelled' || status === 'canceled') {
    return { status: 'cancelled', error: result || 'Tool execution cancelled' };
  }
  if (
    item?.success === false
    || item?.is_error === true
    || item?.error
    || (typeof item?.exit_code === 'number' && item.exit_code !== 0)
    || ['failed', 'error'].includes(status)
  ) {
    return failedOutcome(result);
  }
  return undefined;
};

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
  /** call/item id → tool name, so end events can name their chip. */
  toolNames: ToolNameMap;
}

export const createCodexStreamState = (): CodexStreamState => ({
  sawDelta: false, parts: [], toolNames: new Map(),
});

const pushText = (state: CodexStreamState, text: unknown, onText: (delta: string) => void): void => {
  if (typeof text !== 'string' || !text) return;
  state.parts.push(text);
  onText(text);
};

export function consumeCodexStreamLine(
  state: CodexStreamState,
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

  // Dialect A: protocol events `{id, msg:{type, ...}}`.
  const msg = event?.msg;
  if (msg && typeof msg.type === 'string') {
    const begin = TOOL_BEGIN[msg.type];
    if (begin) {
      const { name, args } = begin(msg);
      startTool(state.toolNames, handlers, msg.call_id ?? event.id, name, args);
      return;
    }
    const end = TOOL_END[msg.type];
    if (end) {
      const finished = end(msg);
      finishTool(
        state.toolNames,
        handlers,
        msg.call_id ?? event.id,
        finished.result,
        'tool',
        finished.outcome,
      );
      return;
    }
    switch (msg.type) {
      case 'session_configured':
        if (typeof msg.session_id === 'string' && msg.session_id) state.sessionId = msg.session_id;
        return;
      case 'agent_message_delta':
        state.sawDelta = true;
        pushText(state, msg.delta, handlers.onText);
        return;
      case 'agent_message':
        if (!state.sawDelta) pushText(state, msg.message, handlers.onText);
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
  if (event.type === 'item.started' || event.type === 'item.completed') {
    const item = event.item;
    const kind = String(item?.item_type ?? item?.type ?? '');
    if (kind === 'agent_message') {
      if (event.type === 'item.completed' && !state.sawDelta) pushText(state, item?.text, handlers.onText);
      return;
    }
    const toolName = ITEM_TOOL_NAMES[kind];
    if (!toolName) return;
    if (event.type === 'item.started') startTool(state.toolNames, handlers, item?.id, toolName, item);
    // completed without a started still surfaces (finishTool back-fills the call).
    else {
      const result = itemResultText(item);
      finishTool(state.toolNames, handlers, item?.id, result, toolName, itemOutcome(item, result));
    }
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
    onLine: (line) => consumeCodexStreamLine(state, line, request),
  });

  if (state.errorMessage) throw new Error(state.errorMessage);
  const text = state.resultText ?? state.parts.join('');
  if (exit.code !== 0 && !text) {
    throw new Error(`"${command}" exited with code ${exit.code}: ${exit.stderrTail || 'no output'}`);
  }
  return { text, sessionId: state.sessionId };
}
