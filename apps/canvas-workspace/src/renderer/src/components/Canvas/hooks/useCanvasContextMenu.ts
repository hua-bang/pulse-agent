import { useCallback, useState, type RefObject } from 'react';
import type { CanvasNode } from '../../../types';
import { getNodeDefaultSize, NODE_TYPE_LABELS } from '../../../utils/nodeFactory';
import type { ToastInput } from '../../../types/ui-interaction';

type CreatableNodeType =
  | 'file'
  | 'terminal'
  | 'frame'
  | 'group'
  | 'agent'
  | 'text'
  | 'iframe'
  | 'mindmap';

interface ContextMenuState {
  screenX: number;
  screenY: number;
  canvasX: number;
  canvasY: number;
}

interface Options {
  containerRef: RefObject<HTMLDivElement>;
  screenToCanvas: (
    clientX: number,
    clientY: number,
    container: HTMLDivElement,
  ) => { x: number; y: number };
  addNode: (type: CreatableNodeType, x: number, y: number) => CanvasNode;
  setSelectedNodeIds: (ids: string[]) => void;
  /** Brief flash on the new node so the user can spot it after a
   *  context-menu/toolbar/palette add. Reuses the existing 1.5s
   *  `nodeHighlight` animation. */
  setHighlightedId: (id: string | null) => void;
  /** Toast surface for the post-add confirmation. */
  notify: (toast: ToastInput) => string;
}

/**
 * Owns the right-click / double-click context menu state plus the
 * "create node here" / "create node centered in viewport" callbacks.
 * `isBlankCanvasTarget` is exported so the root mouse handlers can
 * reuse the same DOM-target check that gates the menu.
 */
export const useCanvasContextMenu = ({
  containerRef,
  screenToCanvas,
  addNode,
  setSelectedNodeIds,
  setHighlightedId,
  notify,
}: Options) => {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  /** Shared post-add side effects: select, flash, and toast the new node
   *  so every entry point (right-click, toolbar, palette, empty-canvas
   *  hint) gives the same visible confirmation. The placement hint
   *  varies per entry point — right-click drops at cursor, toolbar
   *  centers on viewport — so callers pass it in. */
  const finalizeAddedNode = useCallback(
    (node: CanvasNode, type: CreatableNodeType, placementHint: string) => {
      setSelectedNodeIds([node.id]);
      setHighlightedId(node.id);
      notify({
        tone: 'success',
        title: `${NODE_TYPE_LABELS[type]} added`,
        description: placementHint,
      });
    },
    [notify, setHighlightedId, setSelectedNodeIds],
  );

  const isBlankCanvasTarget = useCallback((target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    return !target.closest(
      '.canvas-node, .floating-toolbar, .zoom-indicator, .context-menu, .canvas-edges, .canvas-connect-overlay, .canvas-shape-overlay, .edge-style-panel',
    );
  }, []);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (!isBlankCanvasTarget(e.target)) return;
      if (!containerRef.current) return;
      const pos = screenToCanvas(e.clientX, e.clientY, containerRef.current);
      setContextMenu({ screenX: e.clientX, screenY: e.clientY, canvasX: pos.x, canvasY: pos.y });
    },
    [isBlankCanvasTarget, screenToCanvas, containerRef],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!isBlankCanvasTarget(e.target)) return;
      if (!containerRef.current) return;
      const pos = screenToCanvas(e.clientX, e.clientY, containerRef.current);
      setContextMenu({ screenX: e.clientX, screenY: e.clientY, canvasX: pos.x, canvasY: pos.y });
    },
    [isBlankCanvasTarget, screenToCanvas, containerRef],
  );

  const handleCreateNode = useCallback(
    (type: CreatableNodeType) => {
      if (!contextMenu) return;
      // Right-click drop point becomes the new node's top-left so the
      // node grows down-right from the cursor — matches typical
      // "create here" affordances in design tools.
      const node = addNode(type, contextMenu.canvasX, contextMenu.canvasY);
      finalizeAddedNode(node, type, 'Placed at the cursor');
      setContextMenu(null);
    },
    [addNode, contextMenu, finalizeAddedNode],
  );

  const handleToolbarAddNode = useCallback(
    (type: CreatableNodeType) => {
      if (!containerRef.current) return;
      // Center the new node on the current viewport: project the
      // container's screen-space midpoint into canvas coordinates, then
      // offset by half the node's default size so the node — not its
      // top-left corner — lands at that midpoint. Half-dimensions come
      // from `getNodeDefaultSize` (the same numbers `createDefaultNode`
      // will write to `node.width`/`node.height`), keeping the centering
      // honest as defaults evolve.
      const rect = containerRef.current.getBoundingClientRect();
      const center = screenToCanvas(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
        containerRef.current,
      );
      const { width, height } = getNodeDefaultSize(type);
      const node = addNode(type, center.x - width / 2, center.y - height / 2);
      finalizeAddedNode(node, type, 'Centered on the current viewport');
    },
    [addNode, screenToCanvas, finalizeAddedNode, containerRef],
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  return {
    contextMenu,
    setContextMenu,
    closeContextMenu,
    isBlankCanvasTarget,
    handleContextMenu,
    handleDoubleClick,
    handleCreateNode,
    handleToolbarAddNode,
  };
};
