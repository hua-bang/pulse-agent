import { scopeSessionStoreId } from '../../shared/agent-chat';
import { SessionStore } from './session-store';
import type { AgentScope, CanvasAgentSession } from './types';

interface SessionPointerAgent {
  getCurrentSessionId(): string | null;
  loadSession(sessionId: string): Promise<CanvasAgentSession | null>;
}

export async function loadCanvasAgentSessionFromStore(scope: AgentScope, sessionId: string) {
  const store = new SessionStore(scopeSessionStoreId(scope), scope);
  await store.restoreCurrentSession();
  const session = await store.loadSession(sessionId);
  return { session, activeSessionId: store.getCurrentSession()?.sessionId ?? null };
}

/** Create the next durable conversation without starting the tool-capable Agent. */
export async function startCanvasAgentSessionInStore(scope: AgentScope): Promise<string | null> {
  const store = new SessionStore(scopeSessionStoreId(scope), scope);
  // Preserve an already-empty draft, matching the live Agent's store behavior.
  await store.restoreCurrentSession();
  await store.startSession();
  return store.getCurrentSession()?.sessionId ?? null;
}

export async function reconcileAgentWithStoredSession(
  scope: AgentScope,
  agent: SessionPointerAgent,
): Promise<void> {
  const currentSessionId = await SessionStore.readCurrentSessionId(scopeSessionStoreId(scope));
  if (!currentSessionId || agent.getCurrentSessionId() === currentSessionId) return;
  const loaded = await agent.loadSession(currentSessionId);
  if (!loaded || agent.getCurrentSessionId() !== currentSessionId) {
    throw new Error(`Could not reconcile Agent to durable session ${currentSessionId}`);
  }
}
