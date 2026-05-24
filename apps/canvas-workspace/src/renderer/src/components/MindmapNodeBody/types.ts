import type { CanvasNode } from '../../types';

export interface MindmapNodeBodyProps {
  node: CanvasNode;
  isSelected: boolean;
  isOuterDragging?: boolean;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
  onSelectNode: (id: string) => void;
  onAutoResize: (id: string, width: number, height: number) => void;
  readOnly?: boolean;
}

export type KeyAction =
  | { kind: 'addChild'; pendingText?: string }
  | { kind: 'addSibling'; pendingText?: string }
  | { kind: 'unindent'; pendingText?: string }
  | { kind: 'delete' }
  | { kind: 'toggle' }
  | { kind: 'exit' }
  | { kind: 'move'; dir: 'up' | 'down' | 'left' | 'right' };

export type DropHint = 'before' | 'after' | 'child' | null;
