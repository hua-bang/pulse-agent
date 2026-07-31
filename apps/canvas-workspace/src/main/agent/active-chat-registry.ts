import type { AgentScope } from './types';
import { scopeSessionStoreId } from '../../shared/agent-chat';

interface ActiveChatRun {
  scope: AgentScope;
  controller: AbortController;
}

interface ReservedChatRun {
  scope: AgentScope;
  controller: AbortController;
}

/**
 * Owns run-scoped cancellation from start acknowledgement until completion.
 * The signal latches an early abort even while scope activation is pending.
 */
export class ActiveChatRegistry {
  private readonly active = new Map<string, ActiveChatRun>();
  private readonly reserved = new Map<string, ReservedChatRun>();

  reserve(sessionId: string, scope: AgentScope): boolean {
    if (this.active.has(sessionId) || this.reserved.has(sessionId)) {
      throw new Error(`Chat run already registered: ${sessionId}`);
    }
    if (this.hasScope(scope)) return false;
    this.reserved.set(sessionId, { scope, controller: new AbortController() });
    return true;
  }

  startReserved(sessionId: string): AbortSignal | null {
    const reservation = this.reserved.get(sessionId);
    if (!reservation) return null;
    this.reserved.delete(sessionId);
    this.active.set(sessionId, reservation);
    return reservation.controller.signal;
  }

  register(sessionId: string, scope: AgentScope): AbortSignal | null {
    return this.reserve(sessionId, scope) ? this.startReserved(sessionId) : null;
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

  scopeOf(sessionId: string): AgentScope | undefined {
    return this.active.get(sessionId)?.scope;
  }

  abort(sessionId: string): boolean {
    const run = this.active.get(sessionId) ?? this.reserved.get(sessionId);
    if (!run) return false;
    run.controller.abort();
    return true;
  }

  settle(sessionId: string): void {
    this.active.delete(sessionId);
    this.reserved.delete(sessionId);
  }

  releaseReservation(sessionId: string): boolean {
    return this.reserved.delete(sessionId);
  }

  clear(): void {
    for (const run of this.active.values()) run.controller.abort();
    for (const run of this.reserved.values()) run.controller.abort();
    this.active.clear();
    this.reserved.clear();
  }
}
