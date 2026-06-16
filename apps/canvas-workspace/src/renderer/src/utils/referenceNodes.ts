import type { CanvasNode } from '../types';

const REFERENCEABLE_NODE_TYPES = new Set<CanvasNode['type']>([
  'file',
  'text',
  'iframe',
  'image',
  'shape',
  'mindmap',
  'plugin',
]);

export const isReferenceableNodeType = (type: CanvasNode['type'] | undefined): boolean => (
  !!type && REFERENCEABLE_NODE_TYPES.has(type)
);

export const isReferenceableNode = (node: CanvasNode): boolean => (
  isReferenceableNodeType(node.type)
);
