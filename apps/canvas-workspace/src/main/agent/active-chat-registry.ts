import type { AgentScope } from './types';
import { scopeSessionStoreId } from '../../shared/agent-chat';

interface ActiveChatRun {
  scope: AgentScope;
  controller: AbortController;
  /** Conversation session the run is anchored to, when known. */
  conversationSessionId?: string;
}

interface ReservedChatRun {
  scope: AgentScope;
  controller: AbortController;
  conversationSessionId?: string;
}

export type ChatRunStreamChannel =
  | 'text-delta'
  | 'chat-complete'
  | 'tool-call'
  | 'tool-result'
  | 'tool-input-start'
  | 'tool-input-delta'
  | 'tool-input-end'
  | 'clarify-request'
  | 'role-turn-start'
  | 'role-turn-end';

export interface ChatRunStreamEvent {
  sequence: number;
  channel: ChatRunStreamChannel;
  data: unknown;
}

interface ChatRunStreamJournal {
  nextSequence: number;
  events: ChatRunStreamEvent[];
  settledAt?: number;
}

const STREAM_JOURNAL_TTL_MS = 60_000;
const MAX_STREAM_JOURNAL_EVENTS = 10_000;

/**
 * Owns run-scoped cancellation from start acknowledgement until completion.
 * The signal latches an early abort even while scope activation is pending.
 *
 * Runs are gated per conversation session, not per scope: two different
 * conversations in the same workspace may run concurrently (session-anchored
 * runs), while a second run against the SAME conversation is rejected. When a
 * run has no conversation session (legacy callers, e.g. scheduled tasks that
 * do not pin a session), it falls back to the historical per-scope rule so the
 * scope stays single-run.
 */
export class ActiveChatRegistry {
  private readonly active = new Map<string, ActiveChatRun>();
  private readonly reserved = new Map<string, ReservedChatRun>();
  private readonly streamJournals = new Map<string, ChatRunStreamJournal>();

  reserve(
    sessionId: string,
    scope: AgentScope,
    conversationSessionId?: string,
  ): boolean {
    if (this.active.has(sessionId) || this.reserved.has(sessionId)) {
      throw new Error(`Chat run already registered: ${sessionId}`);
    }
    if (this.hasConversationSession(scope, conversationSessionId)) return false;
    this.reserved.set(sessionId, { scope, controller: new AbortController(), conversationSessionId });
    this.streamJournals.set(sessionId, { nextSequence: 1, events: [] });
    return true;
  }

  startReserved(sessionId: string): AbortSignal | null {
    const reservation = this.reserved.get(sessionId);
    if (!reservation) return null;
    this.reserved.delete(sessionId);
    this.active.set(sessionId, reservation);
    return reservation.controller.signal;
  }

  register(
    sessionId: string,
    scope: AgentScope,
    conversationSessionId?: string,
  ): AbortSignal | null {
    return this.reserve(sessionId, scope, conversationSessionId)
      ? this.startReserved(sessionId)
      : null;
  }

  has(sessionId: string): boolean {
    return this.active.has(sessionId);
  }

  hasScope(scope: AgentScope): boolean {
    const scopeId = scopeSessionStoreId(scope);
    return [...this.active.values(), ...this.reserved.values()].some(
      run => scopeSessionStoreId(run.scope) === scopeId,
    );
  }

  /**
   * True when the scope already owns a run for `conversationSessionId`.
   * Without a conversation session this degrades to the per-scope rule.
   * A conversation-less run is scope-exclusive, so it also blocks explicit
   * conversation-anchored runs (they would both target the current session).
   */
  hasConversationSession(
    scope: AgentScope,
    conversationSessionId: string | null | undefined,
  ): boolean {
    if (conversationSessionId === undefined || conversationSessionId === null) {
      return this.hasScope(scope);
    }
    const scopeId = scopeSessionStoreId(scope);
    return [...this.active.values(), ...this.reserved.values()].some(
      run => (
        scopeSessionStoreId(run.scope) === scopeId
        && (
          run.conversationSessionId === conversationSessionId
          || run.conversationSessionId === undefined
        )
      ),
    );
  }

  sessionIdForScope(scope: AgentScope): string | undefined {
    const scopeId = scopeSessionStoreId(scope);
    for (const [sessionId, run] of this.active) {
      if (scopeSessionStoreId(run.scope) === scopeId) return sessionId;
    }
    for (const [sessionId, run] of this.reserved) {
      if (scopeSessionStoreId(run.scope) === scopeId) return sessionId;
    }
    return undefined;
  }

  /** All conversation session ids with an active run in the scope (parallel). */
  allConversationSessionIdsForScope(scope: AgentScope): string[] {
    const scopeId = scopeSessionStoreId(scope);
    const ids = new Set<string>();
    for (const run of [...this.active.values(), ...this.reserved.values()]) {
      if (
        scopeSessionStoreId(run.scope) === scopeId
        && run.conversationSessionId !== undefined
      ) {
        ids.add(run.conversationSessionId);
      }
    }
    return [...ids];
  }

  /** The conversation session id of the first run in the scope, if any. */
  conversationSessionIdForScope(scope: AgentScope): string | undefined {
    const scopeId = scopeSessionStoreId(scope);
    for (const run of [...this.active.values(), ...this.reserved.values()]) {
      if (scopeSessionStoreId(run.scope) === scopeId) {
        return run.conversationSessionId;
      }
    }
    return undefined;
  }

  /**
   * The run (registry) id for a specific conversation in the scope. A legacy
   * conversation-less run is scope-exclusive, so it reports busy for every
   * conversation (mirrors {@link hasConversationSession}).
   */
  runSessionIdForConversation(
    scope: AgentScope,
    conversationSessionId: string | null | undefined,
  ): string | undefined {
    const scopeId = scopeSessionStoreId(scope);
    const all = [...this.active.entries(), ...this.reserved.entries()];
    for (const [runId, run] of all) {
      if (
        scopeSessionStoreId(run.scope) === scopeId
        && run.conversationSessionId === conversationSessionId
      ) {
        return runId;
      }
    }
    for (const [runId, run] of all) {
      if (
        scopeSessionStoreId(run.scope) === scopeId
        && run.conversationSessionId === undefined
      ) {
        return runId;
      }
    }
    return undefined;
  }

  /** Conversation session a run (registry id) anchors to, if any. */
  conversationSessionIdOf(sessionId: string): string | undefined {
    return this.active.get(sessionId)?.conversationSessionId
      ?? this.reserved.get(sessionId)?.conversationSessionId;
  }

  scopeOf(sessionId: string): AgentScope | undefined {
    return this.active.get(sessionId)?.scope;
  }

  abort(sessionId: string): boolean {
    const run = this.active.get(sessionId) ?? this.reserved.get(sessionId);
    if (!run) return false;
    run.controller.abort();
    return true;
  }

  /** Record renderer-facing stream output so a switched-away chat can replay it. */
  recordStreamEvent(
    sessionId: string,
    channel: ChatRunStreamChannel,
    data: unknown,
  ): void {
    const journal = this.streamJournals.get(sessionId);
    if (!journal || journal.settledAt !== undefined) return;
    journal.events.push({
      sequence: journal.nextSequence++,
      channel,
      data,
    });
    if (journal.events.length > MAX_STREAM_JOURNAL_EVENTS) {
      journal.events.splice(0, journal.events.length - MAX_STREAM_JOURNAL_EVENTS);
    }
  }

  /** Read events after a renderer-owned cursor; settled journals survive briefly. */
  readStreamEvents(sessionId: string, afterSequence: number): {
    active: boolean;
    cursor: number;
    events: ChatRunStreamEvent[];
  } | null {
    this.pruneStreamJournals();
    const journal = this.streamJournals.get(sessionId);
    if (!journal) return null;
    const cursor = journal.nextSequence - 1;
    return {
      active: this.active.has(sessionId) || this.reserved.has(sessionId),
      cursor,
      events: journal.events.filter(event => event.sequence > afterSequence),
    };
  }

  settle(sessionId: string): void {
    this.active.delete(sessionId);
    this.reserved.delete(sessionId);
    const journal = this.streamJournals.get(sessionId);
    if (journal) journal.settledAt = Date.now();
  }

  releaseReservation(sessionId: string): boolean {
    const released = this.reserved.delete(sessionId);
    if (released) this.streamJournals.delete(sessionId);
    return released;
  }

  clear(): void {
    for (const run of this.active.values()) run.controller.abort();
    for (const run of this.reserved.values()) run.controller.abort();
    this.active.clear();
    this.reserved.clear();
    this.streamJournals.clear();
  }

  private pruneStreamJournals(): void {
    const cutoff = Date.now() - STREAM_JOURNAL_TTL_MS;
    for (const [sessionId, journal] of this.streamJournals) {
      if (journal.settledAt !== undefined && journal.settledAt < cutoff) {
        this.streamJournals.delete(sessionId);
      }
    }
  }
}
