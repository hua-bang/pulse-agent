import type { CanvasNode } from '../../types';

export const DEFAULT_REFERENCE_DRAWER_WIDTH = 520;
export const MIN_REFERENCE_DRAWER_WIDTH = 320;
export const MAX_REFERENCE_DRAWER_WIDTH = 1000;
export const REFERENCE_SEARCH_DEBOUNCE_MS = 180;

export const PICKER_NODE_TYPE_GROUP_ORDER: CanvasNode['type'][] = [
  'iframe',
  'dynamic-app',
  'plugin',
  'file',
  'text',
  'image',
  'agent',
  'terminal',
  'mindmap',
  'reference',
  'shape',
  'frame',
  'group',
];
