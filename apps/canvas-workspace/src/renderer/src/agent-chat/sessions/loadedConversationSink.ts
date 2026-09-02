import type { AgentChatMessage, AgentScope } from '../../types';

export interface LoadedConversation {
  scope: AgentScope;
  sessionId: string;
  messages: AgentChatMessage[];
  expectedSequence?: number;
}

export function deliverLoadedConversation(input: {
  scope: AgentScope;
  sessionId?: string | null;
  messages: AgentChatMessage[];
  expectedSequence?: number;
  onMessagesLoaded?: (messages: AgentChatMessage[]) => void;
  onConversationLoaded?: (loaded: LoadedConversation) => void;
}): void {
  input.onMessagesLoaded?.(input.messages);
  if (!input.sessionId) return;
  input.onConversationLoaded?.({
    scope: input.scope,
    sessionId: input.sessionId,
    messages: input.messages,
    expectedSequence: input.expectedSequence,
  });
}
