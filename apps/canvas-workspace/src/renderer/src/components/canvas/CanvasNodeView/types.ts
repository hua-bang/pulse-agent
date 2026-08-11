import type { MouseEvent, ReactNode } from 'react';
import type { AgentContextDomReviewComment, AgentContextDomSelectionRef, CanvasNode } from '../../../types';
import type { ResizeEdge } from '../../../hooks/useNodeResize';
import type { NodeDragOffset } from '../../../hooks/useNodeDrag';
import type { MergeMindmapTopicRequest } from '../../../utils/mindmapTransfer';
import type { ChatDeliveryReceipt } from '../../chat/ChatTargetContext';

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
  /**
   * Bumped by the canvas when Enter / F2 targets THIS node, which starts
   * inline title editing. A monotonic token rather than a boolean so the
   * canvas never has to clear a flag: a repeat rename of the same node is a
   * new token, and every other node sees 0.
   */
  renameToken?: number;
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
  onExportMindmapImage?: (id: string) => void;
  onMergeMindmapTopic?: (request: MergeMindmapTopicRequest) => boolean;
  onSplitMindmapTopic?: (
    sourceNodeId: string,
    sourceTopicId: string,
    clientX: number,
    clientY: number,
  ) => boolean;
  onSelect: (id: string, mods?: { shift?: boolean; meta?: boolean }) => void;
  onFocus: (node: CanvasNode) => void;
  /** Optional copy for the standard focus icon when a read-only preview opens
   * its source node rather than focusing the node in the current canvas. */
  focusAction?: {
    ariaLabel: string;
    title: string;
  };
  onReference?: (nodeId: string) => void;
  onAddToChat?: (nodeId: string) => void | Promise<ChatDeliveryReceipt>;
  /** Place this node on the main canvas as a reference (dock preview only). */
  onAddToCanvas?: (nodeId: string) => void;
  onAddDomSelectionToChat?: (selection: AgentContextDomSelectionRef) => Promise<ChatDeliveryReceipt>;
  onSubmitDomReviewComments?: (comments: AgentContextDomReviewComment[]) => Promise<boolean>;
  resolveReferenceNode?: (node: CanvasNode) => { node?: CanvasNode; workspaceName?: string };
  onOpenReferenceSource?: (node: CanvasNode) => void;
  onUpdateReferenceSource?: (referenceNode: CanvasNode, patch: Partial<CanvasNode>) => void;
  onUngroupSelectedGroups?: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: (nodeId: string) => void;
  readOnly?: boolean;
  /** Keep file nodes on their full Tiptap renderer while preventing edits.
   * Used by Library previews so they match the source canvas node exactly. */
  renderFullFileBody?: boolean;
  embedded?: boolean;
  /** Render only the node body when a surrounding document already owns
   * the title and metadata chrome (for example the node detail page/dock). */
  hideHeader?: boolean;
  renderMode?: CanvasNodeRenderMode;
}

export type ResizeHandlerFactory = (edge: ResizeEdge) => (e: MouseEvent) => void;
export type ReferenceSourceRenderer = (sourceNode: CanvasNode, workspaceLabel: string) => ReactNode;
