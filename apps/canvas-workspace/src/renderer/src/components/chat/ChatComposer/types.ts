import type { CanvasNode } from '../../../types';

export interface SelectedContextChip {
  key: string;
  kind: 'node' | 'tag' | 'canvas';
  nodeType?: CanvasNode['type'];
  label: string;
}
