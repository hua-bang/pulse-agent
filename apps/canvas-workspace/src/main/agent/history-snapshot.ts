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
  const current = await store.restoreCurrentSession();
  if (current && current.messages.length > 0) return current;
  const [latestArchived] = await store.listArchivedSessions();
  return latestArchived ? store.readSession(latestArchived.sessionId) : current;
}

export async function readCanvasAgentHistorySnapshot(
  scope: AgentScope,
  activeAgent: HistoryAgent | undefined,
  warmAgent: () => Promise<void>,
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

  void warmAgent().catch(error => console.error('[canvas-agent-service] background activation failed:', error));
  return {
    messages: session?.messages ?? [],
    activeSessionId: session?.sessionId ?? null,
  };
}
