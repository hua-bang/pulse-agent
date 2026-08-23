import type { AgentChatMessage } from '../../../shared/agent-chat';
import type { CanvasAgent } from '../canvas-agent';
import type {
  ConversationRuntimeDeps,
  TurnRunnerContext,
} from './conversation-runtime';

/**
 * Adapter that turns a workspace's shared `CanvasAgent` (which owns the single
 * Engine + tools/MCP/config/plan-mode) into the `runTurn` seam a
 * ConversationRuntime needs. The agent's `chat` method is session-anchored and
 * persists internally; this adapter only forwards the runtime's per-conversation
 * history + streaming callbacks and does not add its own state.
 *
 * This keeps the shared Engine untouched while the renderer migrates to
 * per-conversation state — the migration is additive (new conversation runtime
 * drives the same agent), so existing 427 agent tests keep passing.
 */
export function createConversationRunner(agent: CanvasAgent): ConversationRuntimeDeps['runTurn'] {
  return async (ctx: TurnRunnerContext) => {
    const result = await agent.chat(
      ctx.message,
      ctx.onText,
      (data) => ctx.onToolCall?.(data),
      (data) => ctx.onToolResult?.(data),
      ctx.mentionedWorkspaceIds,
      (request) => ctx.onClarificationRequest?.(request),
      {
        ...ctx.requestContext,
        expectedConversationSessionId: ctx.expectedSessionId,
      },
      ctx.attachments ?? [],
      (data) => ctx.onToolInputStart?.(data),
      (data) => ctx.onToolInputDelta?.(data),
      (data) => ctx.onToolInputEnd?.(data),
      ctx.onRoleTurnStart,
      ctx.onRoleTurnEnd,
      ctx.signal,
      undefined, // modelConfigOverride
      undefined, // performanceTiming
      // The runtime owns persistence: do not let agent.chat double-append.
      () => undefined,
    );
    if (result.sessionChanged) {
      return {
        response: '',
        code: 'CHAT_SESSION_CHANGED',
        error: result.sessionChanged.error,
      };
    }
    return {
      response: result.response,
      runId: result.runId,
      stopped: result.stopped,
      speakerRole: result.speakerRole,
    };
  };
}

/** Session-store-backed conversation loader for the registry's `create`. */
export function createConversationStoreLoader(agent: CanvasAgent) {
  return {
    loadMessages: async (): Promise<AgentChatMessage[]> => {
      return agent.getHistory() as AgentChatMessage[];
    },
    persist: async (messages: AgentChatMessage[]): Promise<void> => {
      const sessionId = agent.getCurrentSessionId();
      if (!sessionId) return;
      await agent.appendToSession(sessionId, messages as never);
    },
  };
}
