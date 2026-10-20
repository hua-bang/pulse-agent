import type { ModelMessage } from 'ai';
import type { CanvasAgentMessage, CanvasAgentSession } from '../types';
import { sessionMessageToModelMessage } from '../roles/role-turn';

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
      /** Apply a context compaction in place and keep it for later turns. */
      replaceRunMessages: (messages: ModelMessage[]) => void;
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
  // Loaded on first use to keep it out of the main entry chunk.
  const { startCheckpointedRun } = await import('./compaction-checkpoint');
  const run = startCheckpointedRun(targetSession.sessionId, targetSession.messages, sessionMessageToModelMessage);
  return {
    ok: true,
    targetSession,
    runMessages: run.messages,
    runStoreMessages: run.stored,
    appendRunMessages: storeMessages => {
      run.save(storeMessages);
      persist(targetSession.sessionId, storeMessages);
    },
    replaceRunMessages: run.replace,
  };
}
