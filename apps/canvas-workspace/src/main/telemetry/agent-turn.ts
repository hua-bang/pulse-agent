/**
 * Telemetry for one agent turn: `agent_turn_started` when the turn begins
 * and exactly one `agent_turn_finished` when it ends. Props carry counts,
 * kinds, and a coarse error class, never message text or error messages.
 */

import type { AgentRequestContext } from '../../shared/agent-chat';
import type { TelemetryEventName, TelemetryProps } from '../../shared/api/telemetry';

export type AgentTurnTrigger = 'user' | 'schedule';

type Track = <E extends TelemetryEventName>(event: E, props?: TelemetryProps<E>) => void;

interface TurnResult {
  ok: boolean;
  code?: string;
  error?: string;
  stopped?: boolean;
}

interface TurnStartInput {
  scope: string;
  trigger: AgentTurnTrigger;
  requestContext?: AgentRequestContext;
  attachmentCount?: number;
  mentionedWorkspaceCount?: number;
}

const NODE_CREATE_TOOLS = new Set([
  'canvas_create_node',
  'canvas_create_shape',
  'canvas_create_terminal_node',
  'canvas_create_agent_node',
]);

/** Coarse class of a failed turn; the error text itself is never sent. */
export function classifyTurnError(result: TurnResult): string {
  if (result.code && /^[A-Z][A-Z0-9_]{0,40}$/.test(result.code)) return result.code.toLowerCase();
  const error = result.error ?? '';
  if (/\b401\b|\b403\b|unauthori[sz]ed|api[ _-]?key|authentication/i.test(error)) return 'auth';
  if (/\b429\b|rate.?limit|quota/i.test(error)) return 'rate_limit';
  if (/timeout|timed out|ECONN|ENOTFOUND|EAI_AGAIN|network|fetch failed|socket/i.test(error)) return 'network';
  if (/context.{0,20}(length|window)|too many tokens|maximum.{0,20}tokens/i.test(error)) return 'context_length';
  return 'unknown';
}

function countContext(input: TurnStartInput): number {
  const context = input.requestContext;
  return (input.mentionedWorkspaceCount ?? 0)
    + (context?.selectedNodes?.length ?? 0)
    + (context?.tags?.length ?? 0)
    + (context?.canvases?.length ?? 0)
    + (context?.domSelections?.length ?? 0)
    + (context?.tabs?.length ?? 0)
    + (context?.plugins?.length ?? 0);
}

export function startAgentTurnTelemetry(
  input: TurnStartInput,
  track: Track,
  now: () => number = Date.now,
) {
  const startedAt = now();
  let toolCalls = 0;
  let nodesCreated = 0;
  let finished = false;
  track('agent_turn_started', {
    scope: input.scope,
    trigger: input.trigger,
    execution_mode: input.requestContext?.executionMode ?? 'auto',
    has_attachments: (input.attachmentCount ?? 0) > 0,
    context_count: countContext(input),
  });
  return {
    toolCall(name: string): void {
      toolCalls += 1;
      if (NODE_CREATE_TOOLS.has(name)) nodesCreated += 1;
    },
    finish(result: TurnResult): void {
      if (finished) return;
      finished = true;
      const outcome = result.stopped ? 'stopped' : result.ok ? 'completed' : 'failed';
      track('agent_turn_finished', {
        scope: input.scope,
        trigger: input.trigger,
        outcome,
        ...(outcome === 'failed' ? { error_kind: classifyTurnError(result) } : {}),
        duration_ms: Math.max(0, now() - startedAt),
        tool_calls: toolCalls,
        nodes_created: nodesCreated,
      });
    },
  };
}
