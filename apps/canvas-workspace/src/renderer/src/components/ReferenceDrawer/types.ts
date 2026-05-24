import type { CanvasNode } from '../../types';

export interface NodeReferenceEntry {
  kind: 'node';
  workspaceId: string;
  nodeId: string;
  titleSnapshot?: string;
  typeSnapshot?: CanvasNode['type'];
  workspaceNameSnapshot?: string;
}

export interface UrlReferenceEntry {
  kind: 'url';
  id: string;
  url: string;
  title?: string;
  group?: string;
}

export type ReferenceEntry = NodeReferenceEntry | UrlReferenceEntry;
export type ReferenceGroupKey = CanvasNode['type'] | 'url' | 'missing';
export type ReferencePickerMode = 'current' | 'other';

export interface ReferencePickerNodeGroup {
  type: CanvasNode['type'];
  name: string;
  nodes: CanvasNode[];
}
