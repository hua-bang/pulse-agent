import type { AgentScope, CanvasAgentServiceRef, PluginStore } from '../../../types';

const STORE_KEY = 'sessions';

/**
 * Gives each external conversation its own Canvas Agent session, even when
 * several conversations share one agent scope.
 *
 * Canvas keeps a single *current* session per scope; this router maps
 * `scope::conversationId → sessionId` and, before each turn, swaps the scope's
 * current session to the one owned by the conversation (creating it on first
 * contact). Because runs are serialized per scope key, the swap can't race
 * another turn. The map is persisted so conversations keep their history
 * across restarts.
 *
 * Trade-off: the scope's *current* session is shared with the Canvas UI, so
 * the UI for that scope reflects whichever conversation ran last.
 */
export class SessionRouter {
  private map: Record<string, string> = {};
  private loaded = false;

  constructor(
    private readonly service: CanvasAgentServiceRef,
    private readonly store: PluginStore,
  ) {}

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.map = (await this.store.get<Record<string, string>>(STORE_KEY)) ?? {};
    this.loaded = true;
  }

  private key(scope: AgentScope, conversationId: string): string {
    const scopeKey = scope.kind === 'global' ? 'global' : `workspace:${scope.workspaceId}`;
    return `${scopeKey}::${conversationId}`;
  }

  /**
   * Ensure the scope's current session is the one owned by `conversationId`.
   * Call inside the per-scope run guard, before chat.
   */
  async ensureSession(scope: AgentScope, conversationId: string): Promise<void> {
    await this.ensureLoaded();
    const key = this.key(scope, conversationId);
    const desired = this.map[key];

    if (desired) {
      if (this.service.getCurrentSessionIdForScope(scope) === desired) return;
      await this.service.loadSessionForScope(scope, desired);
      // loadSession is a no-op when the session no longer exists; confirm it
      // actually became current, otherwise fall through to a fresh one.
      if (this.service.getCurrentSessionIdForScope(scope) === desired) return;
    }

    await this.service.newSessionForScope(scope);
    const fresh = this.service.getCurrentSessionIdForScope(scope);
    if (fresh) {
      this.map[key] = fresh;
      await this.store.set(STORE_KEY, this.map);
    }
  }

  /**
   * Point a conversation at a specific existing session id. Used when the
   * user switches sessions explicitly (e.g. /session N) so the choice sticks
   * across later turns instead of being overwritten by the mapping.
   */
  async setConversationSession(
    scope: AgentScope,
    conversationId: string,
    sessionId: string,
  ): Promise<void> {
    await this.ensureLoaded();
    this.map[this.key(scope, conversationId)] = sessionId;
    await this.store.set(STORE_KEY, this.map);
  }

  /**
   * Return the persisted session id for a conversation/scope pair without
   * activating or swapping the agent. Used when a channel binds midway through
   * a global chat and wants to copy that prior conversation into the new
   * workspace scope.
   */
  async getConversationSessionId(
    scope: AgentScope,
    conversationId: string,
  ): Promise<string | undefined> {
    await this.ensureLoaded();
    return this.map[this.key(scope, conversationId)];
  }
}
