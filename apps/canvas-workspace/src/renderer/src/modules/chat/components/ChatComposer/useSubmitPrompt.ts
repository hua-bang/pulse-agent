import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentRequestContext } from '../../../../types';
import { buildNodeMentionMarker } from '../../mentions/nodeMentions';
import type { ChatPromptSubmission } from '../../target';

interface NewSessionResult {
  ok: boolean;
  activeSessionId?: string | null;
}

interface UseSubmitPromptOptions {
  blocked: boolean;
  focusInput: () => void;
  notConfigured: boolean;
  openModelSettingsWithHint: () => void;
  requestContext: AgentRequestContext;
  sendMessage: (text: string, requestContext?: AgentRequestContext) => Promise<boolean>;
  /** The session `sendMessage` is keyed to, which trails `activeSessionId`. */
  conversationSessionId: string | null;
  handleNewSession: () => Promise<NewSessionResult>;
}

interface PendingPrompt {
  sessionId: string | null;
  text: string;
  requestContext: AgentRequestContext;
  resolve: (sent: boolean) => void;
}

/**
 * Follows the question with a chip for each asked-about node that the text
 * does not already mention, so the bubble and the saved history keep the node
 * id. The question goes first so the session title reads as the question.
 */
const withNodeChips = (text: string, nodes: ChatPromptSubmission['nodes']): string => {
  const chips = nodes
    .map(node => `@[${buildNodeMentionMarker({ nodeId: node.id, label: node.title })}]`)
    .filter(chip => !text.includes(chip.slice(0, chip.indexOf('|') + 1)));
  return chips.length > 0 ? `${text} ${chips.join(' ')}` : text;
};

/**
 * Shared path for a question sent from outside the composer, such as the
 * canvas "ask about this card" bar. The turn is scoped to the prompt's nodes,
 * not to whatever the composer currently shows. A `newSession` prompt first
 * moves the conversation pointer, then sends once `sendMessage` is keyed to
 * the new session. The pointer (`activeSessionId`) moves a render earlier
 * than that key, and a send in between lands in the old conversation.
 */
export const useSubmitPrompt = ({
  blocked,
  focusInput,
  notConfigured,
  openModelSettingsWithHint,
  requestContext,
  sendMessage,
  conversationSessionId,
  handleNewSession,
}: UseSubmitPromptOptions) => {
  // State, not a ref: setting it re-runs the send effect even when the new
  // session finished activating before the prompt was parked.
  const [pending, setPending] = useState<PendingPrompt | null>(null);
  const pendingRef = useRef<PendingPrompt | null>(null);
  const lifecycleRef = useRef<object | null>(null);
  const sentRef = useRef<PendingPrompt | null>(null);

  useEffect(() => {
    if (!pending || blocked || conversationSessionId !== pending.sessionId) return;
    // Claim it now: the effect can run again before the cleared state renders.
    if (sentRef.current === pending) return;
    sentRef.current = pending;
    pendingRef.current = null;
    setPending(null);
    void sendMessage(pending.text, pending.requestContext).then(pending.resolve, () => pending.resolve(false));
  }, [blocked, conversationSessionId, pending, sendMessage]);

  // An unmounted surface can no longer send; report the prompt as not sent.
  useEffect(() => {
    lifecycleRef.current = {};
    return () => {
      lifecycleRef.current = null;
      pendingRef.current?.resolve(false);
      pendingRef.current = null;
    };
  }, []);

  return useCallback(async (prompt: ChatPromptSubmission): Promise<boolean> => {
    if (!lifecycleRef.current || blocked || pendingRef.current) return false;
    const question = prompt.text.trim();
    if (!question) {
      focusInput();
      return false;
    }
    if (notConfigured) {
      openModelSettingsWithHint();
      return false;
    }

    const text = withNodeChips(question, prompt.nodes);
    const turnContext: AgentRequestContext = {
      ...requestContext,
      scope: prompt.nodes.length > 0 ? 'selected_nodes' : requestContext.scope,
      selectedNodes: prompt.nodes.length > 0 ? prompt.nodes : requestContext.selectedNodes,
    };
    if (!prompt.newSession) return sendMessage(text, turnContext);

    const lifecycle = lifecycleRef.current;
    return new Promise<boolean>((resolve) => {
      // Register before the IPC wait so cleanup can settle even a hung create.
      const request: PendingPrompt = { sessionId: null, text, requestContext: turnContext, resolve };
      pendingRef.current = request;
      void (async () => {
        try {
          const created = await handleNewSession();
          if (lifecycleRef.current !== lifecycle || pendingRef.current !== request) return;
          if (!created.ok || !created.activeSessionId) {
            pendingRef.current = null;
            resolve(false);
            return;
          }
          request.sessionId = created.activeSessionId;
          setPending(request);
        } catch {
          if (lifecycleRef.current !== lifecycle || pendingRef.current !== request) return;
          pendingRef.current = null;
          resolve(false);
        }
      })();
    });
  }, [blocked, focusInput, handleNewSession, notConfigured, openModelSettingsWithHint, requestContext, sendMessage]);
};
