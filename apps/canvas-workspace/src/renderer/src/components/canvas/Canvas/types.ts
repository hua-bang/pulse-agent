import type { AgentContextDomReviewComment, AgentContextDomSelectionRef, CanvasEdge, CanvasNode } from '../../../types';
import type { CanvasClipboard, CanvasNodePatchRequest, CanvasNodeRenameRequest } from '../../../types/ui-interaction';
import type { NodeReferenceEntryForCanvas } from '../../dock/ReferenceDrawer';
import type { ChatDeliveryReceipt } from '../../chat/ChatTargetContext';

export interface CanvasProps {
  canvasId: string;
  canvasName?: string;
  rootFolder?: string;
  /** Whether the canvas is visible/live. This also drives workspace-scoped
   * node lifecycles; embedded hosts should not use it for focus ownership. */
  isActive?: boolean;
  /** Whether this Canvas currently owns document-level shortcuts and paste.
   * Defaults to `isActive`; split hosts can keep a visible canvas live while
   * the adjacent surface owns the keyboard. */
  keyboardActive?: boolean;
  /** Keep pan/zoom local to this Canvas instance instead of overwriting the
   * workspace's canonical viewport. Used by the AI Chat dock editor. */
  persistViewport?: boolean;
  onNodesChange?: (canvasId: string, nodes: CanvasNode[]) => void;
  onEdgesChange?: (canvasId: string, edges: CanvasEdge[]) => void;
  onSelectionChange?: (canvasId: string, selectedNodeIds: string[]) => void;
  focusNodeId?: string;
  onFocusComplete?: () => void;
  deleteNodeId?: string;
  onDeleteComplete?: () => void;
  renameRequest?: CanvasNodeRenameRequest;
  onRenameComplete?: () => void;
  chatPanelOpen?: boolean;
  onChatToggle?: () => void;
  onChatOpen?: () => void;
  referenceDrawerOpen?: boolean;
  onReferenceToggle?: () => void;
  onPinReferenceNode?: (nodeId: string) => void;
  onAddToChat?: (nodeId: string) => void | Promise<ChatDeliveryReceipt>;
  onAddDomSelectionToChat?: (selection: AgentContextDomSelectionRef) => Promise<ChatDeliveryReceipt>;
  onSubmitDomReviewComments?: (comments: AgentContextDomReviewComment[]) => Promise<boolean>;
  resolveReferenceNode?: (node: CanvasNode) => { node?: CanvasNode; workspaceName?: string };
  onOpenReferenceSource?: (node: CanvasNode) => void;
  onUpdateReferenceSource?: (referenceNode: CanvasNode, patch: Partial<CanvasNode>) => void;
  referencePlacementRequest?: NodeReferenceEntryForCanvas | null;
  onReferencePlacementComplete?: () => void;
  createReferenceNode?: (entry: NodeReferenceEntryForCanvas, x: number, y: number) => CanvasNode | null;
  clipboard?: CanvasClipboard | null;
  onClipboardChange?: (clipboard: CanvasClipboard | null) => void;
  onPasteReferences?: (targetWorkspaceId: string, clipboard: CanvasClipboard) => CanvasNode[];
  nodePatchRequest?: CanvasNodePatchRequest;
  onNodePatchComplete?: (requestId: number) => void;
  onSetRootFolder?: () => void;
  onCreateDemoCanvas?: () => void;
}
