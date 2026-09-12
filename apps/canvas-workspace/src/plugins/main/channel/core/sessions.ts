import type { AgentScope, PluginStore } from '../../../types';
import type { ConversationRuntimeService } from '../../../../main/agent/conversation-runtime/conversation-service';

const STORE_KEY = 'sessions';

/**
 * Durable `(scope, channel, conversation) -> sessionId` routing for external
 * chats. Sessions are provisioned and copied through the conversation runtime,
 * so routing never moves the Canvas UI's current-session pointer.
 */
export class SessionRouter {
  private map: Record<string, string> = {};
  private loaded = false;
  private loadFlight: Promise<void> | null = null;
  private mutationTail: Promise<void> = Promise.resolve();
  private readonly routeFlights = new Map<string, Promise<string>>();
  private readonly sessionOwners = new Map<string, string>();

  constructor(
    private readonly runtime: ConversationRuntimeService,
    private readonly store: PluginStore,
  ) {}

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (!this.loadFlight) {
      this.loadFlight = this.store.get<Record<string, string>>(STORE_KEY).then((stored) => {
        this.map = { ...(stored ?? {}) };
        this.loaded = true;
      }).finally(() => {
        this.loadFlight = null;
      });
    }
    await this.loadFlight;
  }

  private scopeKey(scope: AgentScope): string {
    return scope.kind === 'global' ? 'global' : `workspace:${scope.workspaceId}`;
  }

  private key(scope: AgentScope, channelId: string, conversationId: string): string {
    return `${this.scopeKey(scope)}::${channelId}::${conversationId}`;
  }

  private legacyKey(scope: AgentScope, conversationId: string): string {
    return `${this.scopeKey(scope)}::${conversationId}`;
  }

  private ownerKey(scope: AgentScope, sessionId: string): string {
    return `${this.scopeKey(scope)}::${sessionId}`;
  }

  private runMutation<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationTail.catch(() => undefined).then(operation);
    this.mutationTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async persistMapping(routeKey: string, sessionId: string): Promise<void> {
    const previous = this.map[routeKey];
    this.map[routeKey] = sessionId;
    try {
      await this.store.set(STORE_KEY, { ...this.map });
    } catch (err) {
      if (previous === undefined) delete this.map[routeKey];
      else this.map[routeKey] = previous;
      throw err;
    }
  }

  private async claimSession(
    scope: AgentScope,
    routeKey: string,
    sessionId: string,
  ): Promise<string> {
    const ownerKey = this.ownerKey(scope, sessionId);
    const owner = this.sessionOwners.get(ownerKey);
    if (!owner || owner === routeKey) {
      this.sessionOwners.set(ownerKey, routeKey);
      return sessionId;
    }

    // Historical stores could contain duplicate mappings. Fork the durable
    // history for the later route rather than sharing live runtime state or
    // deleting either real history.
    const copied = await this.runtime.copySessionToScope(scope, sessionId, scope);
    if (!copied.ok || !copied.sessionId) {
      throw new Error(copied.error ?? 'Could not isolate duplicated session mapping');
    }
    this.sessionOwners.set(this.ownerKey(scope, copied.sessionId), routeKey);
    return copied.sessionId;
  }

  async ensureSession(
    scope: AgentScope,
    channelId: string,
    conversationId: string,
  ): Promise<string> {
    await this.ensureLoaded();
    const routeKey = this.key(scope, channelId, conversationId);
    const existing = this.routeFlights.get(routeKey);
    if (existing) return existing;

    const flight = this.runMutation(async () => {
      const legacyKey = this.legacyKey(scope, conversationId);
      const mapped = this.map[routeKey] ?? this.map[legacyKey];
      if (mapped && await this.runtime.hasSession(scope, mapped)) {
        const claimed = await this.claimSession(scope, routeKey, mapped);
        if (this.map[routeKey] !== claimed) await this.persistMapping(routeKey, claimed);
        return claimed;
      }

      const created = await this.runtime.provisionSession(scope);
      if (!created.ok || !created.sessionId) {
        throw new Error(created.error ?? 'Could not create conversation session');
      }
      this.sessionOwners.set(this.ownerKey(scope, created.sessionId), routeKey);
      await this.persistMapping(routeKey, created.sessionId);
      return created.sessionId;
    });
    this.routeFlights.set(routeKey, flight);
    try {
      return await flight;
    } finally {
      if (this.routeFlights.get(routeKey) === flight) this.routeFlights.delete(routeKey);
    }
  }

  async createFreshSession(
    scope: AgentScope,
    channelId: string,
    conversationId: string,
  ): Promise<string> {
    await this.ensureLoaded();
    return this.runMutation(async () => {
      const created = await this.runtime.provisionSession(scope);
      if (!created.ok || !created.sessionId) {
        throw new Error(created.error ?? 'Could not create conversation session');
      }
      const routeKey = this.key(scope, channelId, conversationId);
      this.sessionOwners.set(this.ownerKey(scope, created.sessionId), routeKey);
      await this.persistMapping(routeKey, created.sessionId);
      return created.sessionId;
    });
  }

  async setConversationSession(
    scope: AgentScope,
    channelId: string,
    conversationId: string,
    sessionId: string,
  ): Promise<string> {
    await this.ensureLoaded();
    return this.runMutation(async () => {
      if (!await this.runtime.hasSession(scope, sessionId)) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      const routeKey = this.key(scope, channelId, conversationId);
      const claimed = await this.claimSession(scope, routeKey, sessionId);
      await this.persistMapping(routeKey, claimed);
      return claimed;
    });
  }

  async getConversationSessionId(
    scope: AgentScope,
    channelId: string,
    conversationId: string,
  ): Promise<string | undefined> {
    await this.ensureLoaded();
    return this.map[this.key(scope, channelId, conversationId)]
      ?? this.map[this.legacyKey(scope, conversationId)];
  }

  async copyConversationSession(
    sourceScope: AgentScope,
    targetScope: AgentScope,
    channelId: string,
    conversationId: string,
  ): Promise<{ ok: boolean; sessionId?: string; messageCount?: number; error?: string }> {
    const sourceSessionId = await this.getConversationSessionId(
      sourceScope,
      channelId,
      conversationId,
    );
    if (!sourceSessionId) return { ok: true, messageCount: 0 };

    const copied = await this.runtime.copySessionToScope(
      sourceScope,
      sourceSessionId,
      targetScope,
    );
    if (!copied.ok || !copied.sessionId) return copied;
    try {
      const sessionId = await this.setConversationSession(
        targetScope,
        channelId,
        conversationId,
        copied.sessionId,
      );
      return { ...copied, sessionId };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  abort(scope: AgentScope, sessionId: string): boolean {
    return this.runtime.abort(scope, sessionId);
  }
}
