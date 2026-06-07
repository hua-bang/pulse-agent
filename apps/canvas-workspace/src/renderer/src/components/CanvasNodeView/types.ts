import type { MouseEvent, ReactNode } from 'react';
import type { CanvasNode } from '../../types';
import type { ResizeEdge } from '../../hooks/useNodeResize';

export interface CanvasNodeViewProps {
  node: CanvasNode;
  getAllNodes?: () => CanvasNode[];
  rootFolder?: string;
  workspaceId?: string;
  workspaceName?: string;
  isDragging: boolean;
  isResizing: boolean;
  isSelected: boolean;
  isHighlighted: boolean;
  isAgentEdited?: boolean;
  focusState?: 'focused' | 'context' | 'dimmed' | 'neutral';
  onDragStart: (e: MouseEvent, node: CanvasNode) => void;
  onResizeStart: (
    e: MouseEvent,
    nodeId: string,
    width: number,
    height: number,
    edge: ResizeEdge,
    minWidth?: number,
    minHeight?: number
  ) => void;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
  onAutoResize: (id: string, width: number, height: number) => void;
  onRemove: (id: string) => void;
  onRemoveNodes?: (ids: string[]) => void;
  onExportMindmapImage: (id: string) => void;
  onSelect: (id: string, mods?: { shift?: boolean; meta?: boolean }) => void;
  onFocus: (node: CanvasNode) => void;
  onReference?: (nodeId: string) => void;
  onAddToChat?: (nodeId: string) => void;
  resolveReferenceNode?: (node: CanvasNode) => { node?: CanvasNode; workspaceName?: string };
  onOpenReferenceSource?: (node: CanvasNode) => void;
  onUpdateReferenceSource?: (referenceNode: CanvasNode, patch: Partial<CanvasNode>) => void;
  onUngroupSelectedGroups?: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: (nodeId: string) => void;
  readOnly?: boolean;
  embedded?: boolean;
}

export type ResizeHandlerFactory = (edge: ResizeEdge) => (e: MouseEvent) => void;
export type ReferenceSourceRenderer = (sourceNode: CanvasNode, workspaceLabel: string) => ReactNode;
