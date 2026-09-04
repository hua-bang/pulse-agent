import { useCallback } from 'react';
import type { AgentContextDomReviewComment, AgentRequestContext } from '../../../../types';
import { buildDomReviewPrompt } from '../utils/domReviewPrompt';

interface UseSubmitDomReviewCommentsOptions {
  blocked: boolean;
  focusInput: () => void;
  notConfigured: boolean;
  openModelSettingsWithHint: () => void;
  requestContext: AgentRequestContext;
  sendMessage: (text: string, requestContext?: AgentRequestContext) => Promise<boolean>;
}

/** Shared DOM-review submission path for dock and full-page chat composers. */
export const useSubmitDomReviewComments = ({
  blocked,
  focusInput,
  notConfigured,
  openModelSettingsWithHint,
  requestContext,
  sendMessage,
}: UseSubmitDomReviewCommentsOptions) => useCallback(async (
  comments: AgentContextDomReviewComment[],
): Promise<boolean> => {
  if (blocked) return false;
  const validComments = comments.filter(comment => comment.text.trim());
  if (validComments.length === 0) {
    focusInput();
    return false;
  }
  if (notConfigured) {
    openModelSettingsWithHint();
    return false;
  }

  return sendMessage(buildDomReviewPrompt(validComments), {
    ...requestContext,
    domSelections: [
      ...(requestContext.domSelections ?? []),
      ...validComments.map(comment => comment.selection),
    ],
    scope: 'selected_nodes',
  });
}, [blocked, focusInput, notConfigured, openModelSettingsWithHint, requestContext, sendMessage]);
