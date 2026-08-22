import { useCallback, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { AgentChatMessage, AgentScope } from '../../../types';
import type { PendingClarification, ToolCallStatus } from '../types';
import { subscribeReattachedRun } from './chatRunReattach';

interface UseChatRunReattachOptions {
  agentScope: AgentScope;
  setMessages: Dispatch<SetStateAction<AgentChatMessage[]>>;
  setStreamingTools: Dispatch<SetStateAction<ToolCallStatus[]>>;
  setMessageTools: Dispatch<SetStateAction<Map<number, ToolCallStatus[]>>>;
  setCollapsedSections: Dispatch<SetStateAction<Set<number>>>;
  setPendingClarify: Dispatch<SetStateAction<PendingClarification | null>>;
  setClarifyInput: Dispatch<SetStateAction<string>>;
  setClarificationAnswering: Dispatch<SetStateAction<boolean>>;
  setClarificationError: Dispatch<SetStateAction<string | null>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  streamingMsgIdx: MutableRefObject<number>;
  toolIdCounter: MutableRefObject<number>;
  activeUnsubsRef: MutableRefObject<Array<() => void>>;
  replaceMessages: (messages: AgentChatMessage[]) => void;
  onTurnComplete?: () => void;
}

/**
 * Owns re-attaching a chat surface to an already-running conversation stream
 * (switch-back view). Switching back to a session whose run is still in flight
 * subscribes to its live events and keeps the visible thread advancing, instead
 * of parking behind "Another chat view is generating".
 */
export function useChatRunReattach({
  agentScope, setMessages, setStreamingTools, setMessageTools, setCollapsedSections,
  setPendingClarify, setClarifyInput, setClarificationAnswering, setClarificationError,
  setLoading, streamingMsgIdx, toolIdCounter, activeUnsubsRef, replaceMessages, onTurnComplete,
}: UseChatRunReattachOptions) {
  const reattachedRunRef = useRef<{ sessionId: string; unsubs: Array<() => void> } | null>(null);
  const scopeRef = useRef(agentScope);
  scopeRef.current = agentScope;

  const detachReattachedRun = useCallback(() => {
    const attached = reattachedRunRef.current;
    if (!attached) return;
    reattachedRunRef.current = null;
    for (const unsubscribe of attached.unsubs) unsubscribe();
    activeUnsubsRef.current = activeUnsubsRef.current.filter(
      unsubscribe => !attached.unsubs.includes(unsubscribe),
    );
  }, [activeUnsubsRef]);

  /** Subscribe to an already-running conversation so switching back shows live output. */
  const reattachToRun = useCallback((sessionId: string) => {
    if (reattachedRunRef.current?.sessionId === sessionId) return;
    detachReattachedRun();
    // Establish the durable baseline first. The main-process journal retains
    // every event emitted during this await, so replay can safely start at
    // cursor 0 afterwards without a subscribe/history overwrite race.
    const attached = { sessionId, unsubs: [] as Array<() => void> };
    reattachedRunRef.current = attached;
    void (async () => {
      const history = await window.canvasWorkspace.agent
        .getHistory({ scope: scopeRef.current })
        .catch(() => ({ ok: false as const }));
      if (reattachedRunRef.current !== attached) return;
      if (history.ok && history.messages) replaceMessages(history.messages);

      const unsubs = subscribeReattachedRun({
        sessionId,
        isLive: () => reattachedRunRef.current === attached,
        setMessages,
        setStreamingTools,
        setMessageTools,
        setCollapsedSections,
        setPendingClarify,
        setClarifyInput,
        setClarificationAnswering,
        setClarificationError,
        setLoading,
        streamingMsgIdx,
        toolIdCounter,
        onTurnComplete,
        onRunSettled: () => {
          void window.canvasWorkspace.agent
            .getHistory({ scope: scopeRef.current })
            .then(result => {
              if (!result.ok || !result.messages || reattachedRunRef.current !== attached) return;
              replaceMessages(result.messages);
            })
            .catch(() => undefined);
        },
      });
      if (reattachedRunRef.current !== attached) {
        unsubs.forEach(unsubscribe => unsubscribe());
        return;
      }
      attached.unsubs = unsubs;
      activeUnsubsRef.current.push(...unsubs);
    })();
  }, [
    activeUnsubsRef, detachReattachedRun, replaceMessages, setClarificationAnswering,
    setClarificationError, setClarifyInput, setCollapsedSections, setLoading,
    setMessageTools, setMessages, setPendingClarify, setStreamingTools,
    streamingMsgIdx, toolIdCounter, onTurnComplete,
  ]);

  return { detachReattachedRun, reattachToRun };
}
