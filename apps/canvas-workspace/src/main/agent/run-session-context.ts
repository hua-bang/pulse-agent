import type { ModelMessage } from 'ai';
import type { CanvasAgentMessage, CanvasAgentSession } from './types';
import { sessionMessageToModelMessage } from './role-turn';

/** Read/append surface a run needs from the session store. */
export interface RunSessionStore {
  getCurrentSession(): CanvasAgentSession | null;
  readSession(sessionId: string): Promise<CanvasAgentSession | null>;
  appendToSession(sessionId: string, messages: CanvasAgentMessage[]): Promise<void>;
}

export type RunSessionContext =
  | {
      ok: true;
      targetSession: CanvasAgentSession;
      runMessages: ModelMessage[];
      runStoreMessages: CanvasAgentMessage[];
      appendRunMessages: (messages: CanvasAgentMessage[]) => void;
    }
  | {
      ok: false;
      activeSessionId: string | null;
    };

/**
 * Resolve the conversation a run anchors to. The renderer sends the session it
 * was showing; without one we fall back to the current pointer. Session-
 * anchoring lets a different conversation in the same workspace run
 * concurrently while the user switches views — this run never reads or writes
 * the shared "current" pointer.
 */
export async function prepareRunSession(
  store: RunSessionStore,
  expectedConversationSessionId: string | null | undefined,
  persistMessages?: (sessionId: string, messages: CanvasAgentMessage[]) => void,
): Promise<RunSessionContext> {
  const targetSessionId = expectedConversationSessionId
    ?? store.getCurrentSession()?.sessionId
    ?? null;
  const persist = persistMessages
    ?? ((sessionId: string, messages: CanvasAgentMessage[]) => {
      void store.appendToSession(sessionId, messages);
    });
  const targetSession = targetSessionId
    ? await store.readSession(targetSessionId)
    : store.getCurrentSession();
  if (!targetSession) {
    // The conversation was deleted while the message was in flight.
    return {
      ok: false,
      activeSessionId: store.getCurrentSession()?.sessionId ?? null,
    };
  }
  const runMessages: ModelMessage[] = targetSession.messages.map(sessionMessageToModelMessage);
  // Mirrors what has been persisted to the anchored session during this turn.
  const runStoreMessages: CanvasAgentMessage[] = [...targetSession.messages];
  const appendRunMessages = (storeMessages: CanvasAgentMessage[]) => {
    runStoreMessages.push(...storeMessages);
    persist(targetSession.sessionId, storeMessages);
  };
  return {
    ok: true,
    targetSession,
    runMessages,
    runStoreMessages,
    appendRunMessages,
  };
}
