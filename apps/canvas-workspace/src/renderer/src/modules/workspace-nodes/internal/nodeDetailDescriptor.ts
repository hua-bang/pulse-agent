export type NodeDetailSurface = 'document' | 'web' | 'mindmap';

export interface NodeDetailDescriptor {
  surface: NodeDetailSurface;
  layout: 'document' | 'workspace';
  selectEmbeddedNode: boolean;
  backgroundPan: boolean;
}

const DOCUMENT_DETAIL: NodeDetailDescriptor = {
  surface: 'document',
  layout: 'document',
  selectEmbeddedNode: false,
  backgroundPan: false,
};

const WEB_DETAIL: NodeDetailDescriptor = {
  surface: 'web',
  layout: 'workspace',
  selectEmbeddedNode: false,
  backgroundPan: false,
};

const MINDMAP_DETAIL: NodeDetailDescriptor = {
  surface: 'mindmap',
  layout: 'workspace',
  selectEmbeddedNode: true,
  backgroundPan: true,
};

/** One policy table owns the detail surface for a stored node type. Callers
 * never pass a second, potentially contradictory presentation string. */
export const getNodeDetailDescriptor = (type: string | undefined): NodeDetailDescriptor => {
  if (type === 'iframe') return WEB_DETAIL;
  if (type === 'mindmap') return MINDMAP_DETAIL;
  return DOCUMENT_DETAIL;
};
