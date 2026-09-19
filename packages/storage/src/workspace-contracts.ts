import type { CanvasSnapshot, CommitReceipt, ConversationSnapshot } from './contracts.js';
import type { ConversationScopeSnapshot } from './conversation-scopes.js';

export interface WorkspaceConversationState {
  scope: { revision: number; generation: string } | null;
  sessions: Array<{ sessionId: string; revision: number; generation: string }>;
}

export interface WorkspaceBundle {
  canvas: CanvasSnapshot;
  conversationScope: ConversationScopeSnapshot | null;
  conversations: ConversationSnapshot[];
  conversationState: WorkspaceConversationState;
}

export interface WorkspaceBundleImport {
  canvas: Omit<CanvasSnapshot, 'revision' | 'generation'>;
  expectedGeneration?: string;
  currentSessionId?: string | null;
  conversations?: readonly Pick<ConversationSnapshot, 'sessionId' | 'metadata' | 'messages'>[];
}

export interface WorkspaceBundleReceipt extends CommitReceipt {
  /** Complete state for compensating an import without deleting later chat activity. */
  conversationState: WorkspaceConversationState;
}

export interface WorkspaceRepository {
  readBundle(workspaceId: string): Promise<WorkspaceBundle | null>;
  importBundle(input: WorkspaceBundleImport): Promise<WorkspaceBundleReceipt>;
  removeBundle(
    workspaceId: string,
    expectedCanvasRevision: number,
    generation: string,
    expectedConversations?: WorkspaceConversationState,
  ): Promise<CommitReceipt>;
}
