import type { ChatImageAttachment } from '../../types';

export interface ChatComposerDraft {
  input: string;
  html: string;
  attachments: ChatImageAttachment[];
}

type DraftUpdater = (
  previous: ChatComposerDraft,
) => ChatComposerDraft;

const drafts = new Map<string, ChatComposerDraft>();
const listeners = new Map<string, Set<() => void>>();

const emptyDraft = (): ChatComposerDraft => ({
  input: '',
  html: '',
  attachments: [],
});

export const getChatComposerDraft = (scopeId: string): ChatComposerDraft => {
  const current = drafts.get(scopeId);
  if (current) return current;
  const next = emptyDraft();
  drafts.set(scopeId, next);
  return next;
};

export const updateChatComposerDraft = (
  scopeId: string,
  updater: DraftUpdater,
): void => {
  const previous = getChatComposerDraft(scopeId);
  const next = updater(previous);
  if (next === previous) return;
  drafts.set(scopeId, next);
  for (const listener of listeners.get(scopeId) ?? []) listener();
};

/** Drop an unsent draft when a new conversation is created in this scope. */
export const clearChatComposerDraft = (scopeId: string): void => {
  updateChatComposerDraft(scopeId, () => emptyDraft());
};

export const subscribeChatComposerDraft = (
  scopeId: string,
  listener: () => void,
): (() => void) => {
  const scopeListeners = listeners.get(scopeId) ?? new Set<() => void>();
  scopeListeners.add(listener);
  listeners.set(scopeId, scopeListeners);
  return () => {
    scopeListeners.delete(listener);
    if (scopeListeners.size === 0) listeners.delete(scopeId);
  };
};

/** Test-only reset; drafts intentionally live across renderer surface mounts. */
export const resetChatComposerDraftsForTests = (): void => {
  drafts.clear();
  listeners.clear();
};
