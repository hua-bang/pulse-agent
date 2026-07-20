/**
 * An LLM-generated visual product owned by a workspace.
 *
 * Type values are open to extension; v1 covers `html`, `svg`, and `mermaid`.
 */
export type ArtifactType = 'html' | 'svg' | 'mermaid';

export interface ArtifactVersion {
  id: string;
  content: string;
  /** Optional prompt that produced this version, useful as a diff hint. */
  prompt?: string;
  createdAt: number;
}

export interface Artifact {
  id: string;
  workspaceId: string;
  type: ArtifactType;
  title: string;
  versions: ArtifactVersion[];
  /**
   * Index into `versions`. Always `versions.length - 1` after a create/update,
   * but separate so the renderer can switch views without mutating data.
   */
  currentVersionId: string;
  /** When set, the artifact is currently mirrored as this canvas node. */
  pinnedNodeId?: string;
  /** Origin trace: where the artifact came from. */
  source?: {
    sessionId?: string;
    /** Index of the assistant message in that session that produced it. */
    messageIndex?: number;
    origin?: 'agent_tool' | 'inline_promotion' | 'iframe_ai_tab';
  };
  /**
   * Runtime capabilities this artifact's page may invoke (see
   * shared/artifact-capabilities.ts). Set by the creating code, never by the
   * page itself; absent means none.
   */
  capabilities?: string[];
  createdAt: number;
  updatedAt: number;
}
