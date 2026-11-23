import type { CanvasSnapshot, CommitReceipt, ConversationSnapshot, JsonObject, Page, PageRequest } from './contracts.js';
import type { ConversationScopeSnapshot } from './conversation-scopes.js';
import type { WorkspaceManifestCommit } from './workspace-manifest.js';

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
  /** Publish the workspace's manifest entry in the same transaction. */
  manifest?: WorkspaceManifestCommit;
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
  /** Remove the workspace's manifest entry in the same transaction. */
  manifest?: WorkspaceManifestCommit;
}

export interface WorkspaceRepository {
  readBundle(workspaceId: string): Promise<WorkspaceBundle | null>;
  importBundle(input: WorkspaceBundleImport): Promise<WorkspaceBundleReceipt>;
  trashBundle(input: TrashWorkspaceInput): Promise<WorkspaceTrashRecord>;
  getTrashed(workspaceId: string): Promise<WorkspaceTrashRecord | null>;
  listTrashed(request?: PageRequest): Promise<Page<WorkspaceTrashRecord>>;
  /** `manifest` republishes the workspace's entry in the same transaction. */
  restoreBundle(
    workspaceId: string,
    expectedRevision: number,
    generation: string,
    manifest?: WorkspaceManifestCommit,
  ): Promise<CommitReceipt>;
}
