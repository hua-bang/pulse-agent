import type { CanvasNode } from '../../types';

export const FULLSCREEN_NODE_TYPES = new Set<CanvasNode['type']>([
  'file',
  'terminal',
  'agent',
  'iframe',
  'image',
  'mindmap',
  'plugin',
  'text',
]);
