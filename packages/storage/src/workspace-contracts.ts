import type { CanvasSnapshot, CommitReceipt, ConversationSnapshot, JsonObject, Page, PageRequest } from './contracts.js';
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

export interface WorkspaceTrashRecord {
  workspaceId: string;
  generation: string;
  revision: number;
  deletedAt: string;
  /** Host-owned display metadata, such as the original workspace manifest entry. */
  metadata: JsonObject;
}

export interface TrashWorkspaceInput {
  workspaceId: string;
  expectedCanvasRevision: number;
  generation: string;
  expectedConversations: WorkspaceConversationState;
  metadata?: JsonObject;
}

export interface WorkspaceRepository {
  readBundle(workspaceId: string): Promise<WorkspaceBundle | null>;
  importBundle(input: WorkspaceBundleImport): Promise<WorkspaceBundleReceipt>;
  trashBundle(input: TrashWorkspaceInput): Promise<WorkspaceTrashRecord>;
  getTrashed(workspaceId: string): Promise<WorkspaceTrashRecord | null>;
  listTrashed(request?: PageRequest): Promise<Page<WorkspaceTrashRecord>>;
  restoreBundle(workspaceId: string, expectedRevision: number, generation: string): Promise<CommitReceipt>;
  /** Permanent compensation for an unpublished import; user deletion uses trashBundle. */
  removeBundle(
    workspaceId: string,
    expectedCanvasRevision: number,
    generation: string,
    expectedConversations?: WorkspaceConversationState,
  ): Promise<CommitReceipt>;
}
