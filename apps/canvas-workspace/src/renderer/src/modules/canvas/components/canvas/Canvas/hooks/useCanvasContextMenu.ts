import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { CanvasNode } from '../../../../../../types';
import { getNodeDefaultSize, type CreatableCanvasNodeType } from '../../../../../../utils/nodeFactory';
import type { AddNodeOptions } from '../../../..';
import { useFileNodeEditorRegistry } from '../../../../../../shared/fileNodeEditorRegistry';
import { findFreeSlot, resolveNonStackingSlot } from './nodePlacement';

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
  addNode: (type: CreatableCanvasNodeType, x: number, y: number, options?: AddNodeOptions) => CanvasNode;
  /** Live read of the current node list, used to detect stacked
   *  positions before placing a new node. */
  nodesRef: RefObject<CanvasNode[]>;
  setSelectedNodeIds: (ids: string[]) => void;
  /** Brief flash on the new node so the user can spot it after a
   *  context-menu/toolbar/palette add. Reuses the existing 1.5s
   *  `nodeHighlight` animation. */
  setHighlightedId: (id: string | null) => void;
  /** Pan just enough to keep the new node in view, including through a
   *  layout change (Layers panel or Dock) that follows the add. */
  revealNode: (node: CanvasNode) => void;
}

interface AddNodeUiOptions extends AddNodeOptions {
  /** A new note opens ready for typing unless this is `false`, so every
   *  entry point (toolbar, palette, menu) behaves like Text and Mindmap. */
  focusEditor?: boolean;
}

/**
 * Owns the right-click / double-click context menu state plus the
 * "create node here" / "create node centered in viewport" callbacks.
 * `isBlankCanvasTarget` is exported so the root mouse handlers can
 * reuse the same DOM-target check that gates the menu.
 */
/** Share of the visible canvas a toolbar-created frame may take. */
const FRAME_VIEW_SHARE = 0.6;
const MIN_FRAME_SIZE = 240;

/**
 * The default frame (720x600) is larger than a small viewport, so creating
 * one used to pan the camera to fit it. Shrink it to part of the view
 * instead; other node types keep their default size.
 */
const fitFrameToView = (
  type: CreatableCanvasNodeType,
  size: { width: number; height: number },
  topLeft: { x: number; y: number },
  center: { x: number; y: number },
) => {
  if (type !== 'frame') return size;
  const viewWidth = (center.x - topLeft.x) * 2;
  const viewHeight = (center.y - topLeft.y) * 2;
  return {
    width: Math.round(Math.min(size.width, Math.max(MIN_FRAME_SIZE, viewWidth * FRAME_VIEW_SHARE))),
    height: Math.round(Math.min(size.height, Math.max(MIN_FRAME_SIZE, viewHeight * FRAME_VIEW_SHARE))),
  };
};

export const useCanvasContextMenu = ({
  containerRef,
  screenToCanvas,
  addNode,
  nodesRef,
  setSelectedNodeIds,
  setHighlightedId,
  revealNode,
}: Options) => {
  const registry = useFileNodeEditorRegistry();
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    const focus = (nodeId: string) => {
      if (pendingFocus.current !== nodeId) return;
      const editor = registry?.get(nodeId);
      if (editor) {
        pendingFocus.current = null;
        editor.commands.focus('start');
      } else {
        registry?.requestActivation(nodeId);
      }
    };
    const cancel = () => { pendingFocus.current = null; };
    const unsubscribe = registry?.subscribe(focus);
    document.addEventListener('pointerdown', cancel, true);
    return () => {
      unsubscribe?.();
      document.removeEventListener('pointerdown', cancel, true);
    };
  }, [registry]);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  /** Shared post-add side effects: select, flash, and reveal the new node
   *  so every entry point (right-click, toolbar, palette, empty-canvas
   *  hint) gives the same visible confirmation. The node appearing,
   *  selected, is the feedback; a success toast would only repeat it. */
  const finalizeAddedNode = useCallback(
    (node: CanvasNode) => {
      setSelectedNodeIds([node.id]);
      setHighlightedId(node.id);
      revealNode(node);
    },
    [revealNode, setHighlightedId, setSelectedNodeIds],
  );

  const isBlankCanvasTarget = useCallback((target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    return !target.closest(
      '.canvas-node, .canvas-empty-hint, .canvas-fullscreen-chip, .canvas-bottom-chrome, .floating-toolbar, .zoom-indicator, .context-menu, .canvas-edges, .canvas-connect-overlay, .canvas-shape-overlay, .edge-style-panel',
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
    (type: CreatableCanvasNodeType, options?: AddNodeUiOptions) => {
      if (!contextMenu) return;
      // Right-click drop point becomes the new node's top-left so the
      // node grows down-right from the cursor — matches typical
      // "create here" affordances in design tools.
      const slot = resolveNonStackingSlot(
        nodesRef.current ?? [],
        contextMenu.canvasX,
        contextMenu.canvasY,
      );
      const node = addNode(type, slot.x, slot.y, options);
      if (type === 'file' && options?.focusEditor !== false) pendingFocus.current = node.id;
      finalizeAddedNode(node);
      setContextMenu(null);
    },
    [addNode, contextMenu, finalizeAddedNode, nodesRef],
  );

  const handleToolbarAddNode = useCallback(
    (type: CreatableCanvasNodeType, options?: AddNodeUiOptions) => {
      if (!containerRef.current) return;
      // Center the new node on the current viewport: project the
      // container's screen-space midpoint into canvas coordinates, then
      // offset by half the node's default size so the node — not its
      // top-left corner — lands at that midpoint. Half-dimensions come
      // from `getNodeDefaultSize` (the same numbers `createDefaultNode`
      // will write to `node.width`/`node.height`), keeping the centering
      // honest as defaults evolve. The free-slot search then moves it
      // into clear space, so it neither covers existing nodes nor joins
      // (or, for a frame, adopts) them through spatial containment.
      const rect = containerRef.current.getBoundingClientRect();
      const center = screenToCanvas(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
        containerRef.current,
      );
      const defaultSize = fitFrameToView(
        type,
        getNodeDefaultSize(type),
        screenToCanvas(rect.left, rect.top, containerRef.current),
        center,
      );
      const width = typeof options?.nodePatch?.width === 'number'
        ? options.nodePatch.width
        : defaultSize.width;
      const height = typeof options?.nodePatch?.height === 'number'
        ? options.nodePatch.height
        : defaultSize.height;
      const slot = findFreeSlot(
        nodesRef.current ?? [],
        center.x - width / 2,
        center.y - height / 2,
        width,
        height,
      );
      const node = addNode(type, slot.x, slot.y, type === 'frame'
        ? { ...options, nodePatch: { ...options?.nodePatch, width, height } }
        : options);
      if (type === 'file' && options?.focusEditor !== false) pendingFocus.current = node.id;
      finalizeAddedNode(node);
    },
    [addNode, screenToCanvas, finalizeAddedNode, containerRef, nodesRef],
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
