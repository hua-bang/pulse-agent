import { scopeSessionStoreId } from '../../shared/agent-chat';
import { SessionStore } from './session-store';
import type { AgentScope, CanvasAgentMessage, CanvasAgentSession } from './types';

interface HistoryAgent {
  getHistory(): CanvasAgentMessage[];
  getCurrentSessionId(): string | null;
}

export interface CanvasAgentHistorySnapshot {
  messages: CanvasAgentMessage[];
  activeSessionId: string | null;
}

/** Read the choice restoreLastSession would make, without moving its pointer. */
export async function peekLastSession(store: SessionStore): Promise<CanvasAgentSession | null> {
  return store.restoreLastSession();
}

export async function readCanvasAgentHistorySnapshot(
  scope: AgentScope,
  activeAgent: HistoryAgent | undefined,
): Promise<CanvasAgentHistorySnapshot> {
  if (activeAgent) {
    return {
      messages: activeAgent.getHistory(),
      activeSessionId: activeAgent.getCurrentSessionId(),
    };
  }

  const store = new SessionStore(scopeSessionStoreId(scope), scope);
  let session = await peekLastSession(store);
  if (!session) {
    await store.startSession();
    session = store.getCurrentSession();
  }

  return {
    messages: session?.messages ?? [],
    activeSessionId: session?.sessionId ?? null,
  };
}
