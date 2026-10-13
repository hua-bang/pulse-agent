import { useCallback } from 'react';
import type { AgentRequestContext } from '../../../../types';
import type { ChatPromptSubmission } from '../../target';

interface UseSubmitPromptOptions {
  blocked: boolean;
  focusInput: () => void;
  notConfigured: boolean;
  openModelSettingsWithHint: () => void;
  requestContext: AgentRequestContext;
  sendMessage: (text: string, requestContext?: AgentRequestContext) => Promise<boolean>;
}

/**
 * Shared path for a question sent from outside the composer, such as the
 * canvas "ask about this card" bar. The turn is scoped to the prompt's nodes,
 * not to whatever the composer currently shows.
 */
export const useSubmitPrompt = ({
  blocked,
  focusInput,
  notConfigured,
  openModelSettingsWithHint,
  requestContext,
  sendMessage,
}: UseSubmitPromptOptions) => useCallback(async (
  prompt: ChatPromptSubmission,
): Promise<boolean> => {
  if (blocked) return false;
  const text = prompt.text.trim();
  if (!text) {
    focusInput();
    return false;
  }
  if (notConfigured) {
    openModelSettingsWithHint();
    return false;
  }

  return sendMessage(text, {
    ...requestContext,
    scope: prompt.nodes.length > 0 ? 'selected_nodes' : requestContext.scope,
    selectedNodes: prompt.nodes.length > 0 ? prompt.nodes : requestContext.selectedNodes,
  });
}, [blocked, focusInput, notConfigured, openModelSettingsWithHint, requestContext, sendMessage]);
