
// Entry shapes live in the shared cross-process contract so the persisted
// references.json and this drawer always agree on structure.
export type {
  ArtifactReferenceEntry,
  NodeReferenceEntry,
  ReferenceEntry,
  UrlReferenceEntry,
} from '../../../../shared/references';
export type ReferencePickerMode = 'current' | 'other';
