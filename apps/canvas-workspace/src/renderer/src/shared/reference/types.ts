
import type { CanvasNode } from '../../../../shared/canvas';

// Entry shapes live in the shared cross-process contract so the persisted
// references.json and this drawer always agree on structure.
export type {
  ArtifactReferenceEntry,
  NodeReferenceEntry,
  ReferenceEntry,
  UrlReferenceEntry,
} from '../../../../shared/references';
export type ReferencePickerMode = 'current' | 'other';

/** What a canvas reference node points at, as resolved by the workbench.
 * A node reference sets `node`; a whole-canvas reference sets
 * `workspaceNodes` when that canvas is loaded in this window. A missing
 * `workspaceName` means the source workspace no longer exists. */
export interface ResolvedReference {
  node?: CanvasNode;
  workspaceName?: string;
  workspaceNodes?: CanvasNode[];
}
