import type { MouseEvent, ReactNode } from 'react';
import type { AgentContextDomReviewComment, AgentContextDomSelectionRef, CanvasNode } from '../../types';
import type { ResizeEdge } from '../../hooks/useNodeResize';
import type { NodeDragOffset } from '../../hooks/useNodeDrag';

export type CanvasNodeRenderMode = 'full' | 'frame-body' | 'frame-title';

export interface CanvasNodeViewProps {
  node: CanvasNode;
  getAllNodes?: () => CanvasNode[];
  rootFolder?: string;
  workspaceId?: string;
  workspaceName?: string;
  isDragging: boolean;
  /** Live delta while THIS node is being dragged; null otherwise (B7). */
  dragOffset?: NodeDragOffset | null;
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
  onUpdate: (id: string, patch: Partial<CanvasNode>, options?: { history?: boolean }) => void | Promise<void>;
  onAutoResize: (id: string, width: number, height: number) => void;
  onRemove: (id: string) => void;
  onRemoveNodes?: (ids: string[]) => void;
  onExportMindmapImage: (id: string) => void;
  onSelect: (id: string, mods?: { shift?: boolean; meta?: boolean }) => void;
  onFocus: (node: CanvasNode) => void;
  onReference?: (nodeId: string) => void;
  onAddToChat?: (nodeId: string) => void;
  /** Place this node on the main canvas as a reference (dock preview only). */
  onAddToCanvas?: (nodeId: string) => void;
  onAddDomSelectionToChat?: (selection: AgentContextDomSelectionRef) => void;
  onSubmitDomReviewComments?: (comments: AgentContextDomReviewComment[]) => Promise<boolean>;
  resolveReferenceNode?: (node: CanvasNode) => { node?: CanvasNode; workspaceName?: string };
  onOpenReferenceSource?: (node: CanvasNode) => void;
  onUpdateReferenceSource?: (referenceNode: CanvasNode, patch: Partial<CanvasNode>) => void;
  onUngroupSelectedGroups?: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: (nodeId: string) => void;
  readOnly?: boolean;
  embedded?: boolean;
  renderMode?: CanvasNodeRenderMode;
}

export type ResizeHandlerFactory = (edge: ResizeEdge) => (e: MouseEvent) => void;
export type ReferenceSourceRenderer = (sourceNode: CanvasNode, workspaceLabel: string) => ReactNode;
