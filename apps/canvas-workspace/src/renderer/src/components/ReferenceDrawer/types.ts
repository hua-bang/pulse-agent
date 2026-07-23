import type { CanvasNode } from '../../types';

// Entry shapes live in the shared cross-process contract so the persisted
// references.json and this drawer always agree on structure.
export type {
  NodeReferenceEntry,
  ReferenceEntry,
  UrlReferenceEntry,
} from '../../../../shared/references';
export type ReferenceGroupKey = CanvasNode['type'] | 'url' | 'missing';
export type ReferencePickerMode = 'current' | 'other';

export interface ReferencePickerNodeGroup {
  type: CanvasNode['type'];
  name: string;
  nodes: CanvasNode[];
}
