import type { AgentChatMessage } from '../../../types';

export interface ChatAnchor {
  /** Index into the `messages` array this anchor points at. */
  index: number;
  /** Short, mention-stripped label for the TOC entry. */
  label: string;
}

const MAX_LABEL_LEN = 60;

const cleanAnchorLabel = (raw: string): string => {
  const stripped = raw
    .replace(/@\[[^\]]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!stripped) return '';
  return stripped.length > MAX_LABEL_LEN
    ? `${stripped.slice(0, MAX_LABEL_LEN - 1)}…`
    : stripped;
};

/**
 * Build a TOC-style anchor list for a chat session.
 *
 * Each user message starts a new conversation segment, so we surface one
 * anchor per user turn. Anchors are derived state only — nothing here is
 * persisted, and the list is rebuilt whenever `messages` changes.
 */
export const buildChatAnchors = (messages: AgentChatMessage[]): ChatAnchor[] => {
  const anchors: ChatAnchor[] = [];
  messages.forEach((message, index) => {
    if (message.role !== 'user') return;
    const label = cleanAnchorLabel(message.content || '');
    anchors.push({
      index,
      label: label || `Turn ${anchors.length + 1}`,
    });
  });
  return anchors;
};

/** DOM id used by ChatMessage so anchors can scroll into view. */
export const buildAnchorElementId = (workspaceId: string, index: number): string =>
  `chat-anchor-${workspaceId}-${index}`;
