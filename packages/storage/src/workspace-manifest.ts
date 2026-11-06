import type { CommitReceipt, JsonObject } from './contracts.js';

/**
 * The host's workspace list (names, folders, order, active id) as one
 * document. The body is stored whole, so unknown fields round-trip.
 */
export interface WorkspaceManifestSnapshot {
  generation: string;
  revision: number;
  manifest: JsonObject;
}

export interface WorkspaceManifestCommit {
  expectedGeneration?: string;
  /** null creates the document (the one-time legacy import); later writes require its revision. */
  expectedRevision: number | null;
  manifest: JsonObject;
}

/** One document per store. Each commit replaces it and logs one `workspace-manifest` change. */
export interface WorkspaceManifestRepository {
  /** null until a host imports or creates the document. */
  read(): Promise<WorkspaceManifestSnapshot | null>;
  commit(input: WorkspaceManifestCommit): Promise<CommitReceipt>;
}
