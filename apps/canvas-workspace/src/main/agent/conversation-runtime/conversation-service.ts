import type { AgentScope, CanvasAgentMessage, ChatResponse } from '../types';
import type { CanvasAgent } from '../canvas-agent';
import { scopeSessionStoreId } from '../../../shared/agent-chat';
import { conversationKey } from '../../../shared/conversation-runtime';
import type { ConversationTurnExternal } from './conversation-runtime';
import type { ConversationSendInput } from '../../../shared/conversation-runtime';
import { ConversationRuntimeRegistry } from './conversation-runtime-registry';
import { createConversationRunner } from './conversation-runner';

/** Structural store surface the service drives (injectable for tests). */
export interface ConversationStoreAdapter {
  loadMessages(sessionId: string): Promise<CanvasAgentMessage[]>;
  persist(sessionId: string, messages: CanvasAgentMessage[]): Promise<void>;
}

/**
 * Service facade for the conversation-runtime architecture. One registry per
 * scope (a workspace = one shared CanvasAgent + one registry); each
 * conversation key owns an independent runtime (messages, queue, abort,
 * clarification, persistence). The shared agent stays the stateless engine
 * seam. Two conversations in one workspace run fully in parallel; a second
 * turn against the SAME conversation is queued, never interleaved.
 */
export class ConversationRuntimeService {
  private readonly registries = new Map<string, ConversationRuntimeRegistry>();

  constructor(
    private readonly getAgent: (scope: AgentScope) => CanvasAgent | undefined,
    private readonly storeAdapterFactory: (
      storeId: string,
      scope: AgentScope,
    ) => ConversationStoreAdapter,
    private readonly runConversation?: <T>(
      scope: AgentScope,
      sessionId: string,
      operation: () => Promise<T>,
    ) => Promise<T | null>,
  ) {}

  private registryFor(scope: AgentScope): ConversationRuntimeRegistry {
    const key = scopeKey(scope);
    let registry = this.registries.get(key);
    if (!registry) {
      const agent = this.getAgent(scope);
      if (!agent) throw new Error(`No active agent for scope ${key}`);
      const storeId = scopeSessionStoreId(scope);
      const storeAdapter = this.storeAdapterFactory(storeId, scope);
      registry = new ConversationRuntimeRegistry({
        create: (conversationKey) => ({
          key: conversationKey,
          loadMessages: () => storeAdapter.loadMessages(conversationKey.sessionId),
          persist: (messages) => storeAdapter.persist(conversationKey.sessionId, messages),
          runTurn: createConversationRunner(agent),
        }),
      });
      this.registries.set(key, registry);
    }
    return registry;
  }

  /** Run one turn against a conversation. The runtime owns the queue. */
  async chat(
    scope: AgentScope,
    sessionId: string,
    message: string,
    external?: ConversationTurnExternal,
    input?: Omit<ConversationSendInput, 'message'>,
  ): Promise<ChatResponse> {
    try {
      const registry = this.registryFor(scope);
      const runtime = await registry.open(conversationKey(scope, sessionId));
      const operation = () => runtime.sendAndWait({ message, ...input }, external);
      const result = this.runConversation
        ? await this.runConversation(scope, sessionId, operation)
        : await operation();
      if (!result) {
        return { ok: false, code: 'CHAT_SCOPE_BUSY', error: 'This conversation is already running.' };
      }
      if (result.error) {
        return { ok: false, code: result.code, error: result.error };
      }
      return {
        ok: true,
        response: result.response,
        runId: result.runId,
        stopped: result.stopped,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Abort a conversation's active turn. */
  abort(scope: AgentScope, sessionId: string): boolean {
    const registry = this.registries.get(scopeKey(scope));
    const runtime = registry?.get(conversationKey(scope, sessionId));
    return runtime?.abort() ?? false;
  }

  runningSessionIds(scope: AgentScope): string[] {
    return this.registries.get(scopeKey(scope))?.runningSessionIds() ?? [];
  }

  /**
   * Graceful multi-role relay stop for a conversation's in-flight turn (the
   * agent owns the relay segment queue; stop lets the current segment finish
   * and skips the rest).
   */
  stopRelay(scope: AgentScope, sessionId: string): boolean {
    const agent = this.getAgent(scope);
    return agent?.stopRelay(sessionId) ?? false;
  }

  /** Answer a pending clarification in a conversation. */
  answerClarification(scope: AgentScope, sessionId: string, requestId: string, answer: string): boolean {
    const registry = this.registries.get(scopeKey(scope));
    const runtime = registry?.get(conversationKey(scope, sessionId));
    return runtime?.answerClarification(requestId, answer) ?? false;
  }

  /** Dispose all runtimes (app shutdown). */
  disposeAll(): void {
    for (const registry of this.registries.values()) registry.disposeAll();
    this.registries.clear();
  }
}

const scopeKey = (scope: AgentScope): string => {
  if (scope.kind === 'workspace') return `workspace:${scope.workspaceId}`;
  if (scope.kind === 'scheduled') return `scheduled:${scope.taskId}`;
  return 'global';
};
