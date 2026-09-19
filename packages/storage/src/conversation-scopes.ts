import type { CommitReceipt, ConversationCommit, Page, PageRequest } from './contracts.js';

export interface ConversationScopeSnapshot {
  scopeId: string;
  currentSessionId: string | null;
  revision: number;
  generation: string;
}

export interface ConversationRevisionCondition {
  sessionId: string;
  expectedRevision: number;
}

export interface ConversationScopeCommit {
  scopeId: string;
  expectedRevision: number | null;
  expectedGeneration?: string;
  /** Omit to preserve the current pointer; null archives it without removing history. */
  currentSessionId?: string | null;
  /** Checked before any mutation, allowing a branch to preserve its source unchanged. */
  assertConversations?: readonly ConversationRevisionCondition[];
  conversations?: readonly Omit<ConversationCommit, 'scopeId'>[];
  removeConversations?: readonly ConversationRevisionCondition[];
}

/** Pointer transitions and their conversation mutations are one atomic operation. */
export interface ConversationScopeRepository {
  read(scopeId: string): Promise<ConversationScopeSnapshot | null>;
  list(request?: PageRequest): Promise<Page<ConversationScopeSnapshot>>;
  commit(input: ConversationScopeCommit): Promise<CommitReceipt>;
}
