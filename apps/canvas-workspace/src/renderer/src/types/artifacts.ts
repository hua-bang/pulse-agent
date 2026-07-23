import type {
  Artifact,
  ArtifactSummary,
  ArtifactType,
} from '../../../shared/artifacts';

export type * from '../../../shared/artifacts';

export interface ArtifactsApi {
  list: (workspaceId: string) => Promise<{ ok: boolean; artifacts?: Artifact[]; error?: string }>;
  /** Metadata-only listing across all scopes (incl. __global_chat__), newest first. */
  listAll: () => Promise<{ ok: boolean; artifacts?: ArtifactSummary[]; error?: string }>;
  get: (
    workspaceId: string,
    artifactId: string,
  ) => Promise<{ ok: boolean; artifact?: Artifact; error?: string }>;
  create: (
    workspaceId: string,
    input: {
      type: ArtifactType;
      title: string;
      content: string;
      prompt?: string;
      source?: Artifact['source'];
    },
  ) => Promise<{ ok: boolean; artifact?: Artifact; error?: string }>;
  /** Append a new version to an existing artifact, becoming the current one. */
  addVersion: (
    workspaceId: string,
    artifactId: string,
    input: { content: string; prompt?: string },
  ) => Promise<{ ok: boolean; artifact?: Artifact; error?: string }>;
  /** Mutate metadata only (title, currentVersionId, pinnedNodeId). */
  update: (
    workspaceId: string,
    artifactId: string,
    patch: Partial<Pick<Artifact, 'title' | 'currentVersionId' | 'pinnedNodeId'>>,
  ) => Promise<{ ok: boolean; artifact?: Artifact; error?: string }>;
  delete: (
    workspaceId: string,
    artifactId: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  /** Create an iframe canvas node bound to this artifact (mode='artifact'). */
  pinToCanvas: (
    workspaceId: string,
    artifactId: string,
    placement?: { x?: number; y?: number; width?: number; height?: number; title?: string },
  ) => Promise<{ ok: boolean; nodeId?: string; artifact?: Artifact; error?: string }>;
  /** Fires when an artifact is created, updated, or deleted in the main process. */
  onChange: (
    callback: (event: {
      workspaceId: string;
      artifactId: string;
      kind: 'create' | 'update' | 'delete';
    }) => void,
  ) => () => void;
}
