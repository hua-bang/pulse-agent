import type { CommitReceipt } from './contracts.js';

/**
 * The workspace's shared intent/status document, edited by people and the
 * Canvas Agent. It is workspace state, not a user file: it trashes, restores,
 * and is removed with its workspace.
 */
export interface WorkspaceContextSnapshot {
  generation: string;
  workspaceId: string;
  revision: number;
  content: string;
}

export interface WorkspaceContextCommit {
  workspaceId: string;
  /** null creates the document; an existing document always requires its revision. */
  expectedRevision: number | null;
  expectedGeneration?: string;
  content: string;
}

export interface WorkspaceContextRepository {
  /** null when the workspace has no document, is unknown, or is in the trash. */
  read(workspaceId: string): Promise<WorkspaceContextSnapshot | null>;
  /** Rejects with `not_found` until the workspace is registered in storage. */
  commit(input: WorkspaceContextCommit): Promise<CommitReceipt>;
}
