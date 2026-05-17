import { useCallback, useEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import type { CanvasNode } from '../../../types';
import type { EdgeInteractionState } from '../../../hooks/useEdgeInteraction';
import type { ResizeEdge } from '../../../hooks/useNodeResize';

interface MarqueeApi {
  active: boolean;
  begin: (e: React.MouseEvent) => void;
}

interface Options {
  canvasId: string;
  activeTool: string;
  containerRef: RefObject<HTMLDivElement>;
  nodesRef: MutableRefObject<CanvasNode[]>;
  /** Marquee handler may stash the "we just finished a real drag" flag
   *  on this ref so that the trailing click event doesn't fall through
   *  and clear what we just selected. */
  suppressBlankClickRef: MutableRefObject<boolean>;
  setSelectedNodeIds: (ids: string[]) => void;
  setSelectedEdgeId: (id: string | null) => void;
  contextMenu: unknown;
  closeContextMenu: () => void;
  isBlankCanvasTarget: (target: EventTarget | null) => boolean;
  canvasMouseDown: (e: React.MouseEvent) => void;
  canvasMouseMove: (e: React.MouseEvent) => void;
  canvasMouseUp: () => void;
  moving: boolean;
  panning: boolean;
  onDragStart: (e: React.MouseEvent, node: CanvasNode) => void;
  onDragMove: (e: React.MouseEvent) => void;
  onDragEnd: () => void;
  resizingId: string | null;
  onResizeStart: (
    e: React.MouseEvent,
    nodeId: string,
    width: number,
    height: number,
    edge: ResizeEdge,
    minWidth?: number,
    minHeight?: number,
  ) => void;
  onResizeMove: (e: React.MouseEvent) => void;
  onResizeEnd: () => void;
  edgeInteractionState: EdgeInteractionState | null;
  marquee: MarqueeApi;
  shapeToolActive: boolean;
  shapeDraft: unknown;
  commitHistory: () => void;
  onNodesChange?: (canvasId: string, nodes: CanvasNode[]) => void;
}

const isEdgeDragging = (state: EdgeInteractionState | null) =>
  state?.kind === 'connect'
  || state?.kind === 'move-end'
  || state?.kind === 'move-bend'
  || state?.kind === 'move-edge';

/**
 * Owns the root-level pointer plumbing for the canvas: which gesture
 * wins on mousedown (pan / marquee / fall-through), the window-level
 * mousemove+mouseup so drags survive the cursor leaving editable text
 * subtrees, the post-drag history commit, and the computed cursor /
 * iframe-shield class names handed to the container.
 *
 * The `pendingParentNodesRef` pattern keeps the parent's onNodesChange
 * callback from firing mid-drag (which would flood downstream consumers
 * with intermediate node states) while still ensuring the final state
 * lands once the gesture ends.
 */
export const useCanvasMouseHandlers = ({
  canvasId,
  activeTool,
  containerRef,
  nodesRef,
  suppressBlankClickRef,
  setSelectedNodeIds,
  setSelectedEdgeId,
  contextMenu,
  closeContextMenu,
  isBlankCanvasTarget,
  canvasMouseDown,
  canvasMouseMove,
  canvasMouseUp,
  moving,
  panning,
  onDragStart,
  onDragMove,
  onDragEnd,
  resizingId,
  onResizeStart,
  onResizeMove,
  onResizeEnd,
  edgeInteractionState,
  marquee,
  shapeToolActive,
  shapeDraft,
  commitHistory,
  onNodesChange,
}: Options) => {
  // Node drag / resize starts inside node subtrees, but mousemove bubbles
  // through whatever element is currently under the cursor. If that element
  // is an editable text layer (mindmap text, ProseMirror text, etc.), the
  // browser may select/focus text and React's canvas-level move can stop
  // seeing a consistent stream. Track the gesture at the window level too
  // so dragging remains uninterrupted when crossing text.
  const isDraggingRef = useRef(false);
  const pendingParentNodesRef = useRef<CanvasNode[] | null>(null);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      if (contextMenu) closeContextMenu();
      // A click that follows a real marquee drag would otherwise fall
      // through and clear the selection we just made. Consume the flag
      // (set in handleMarqueeSelect) and bail.
      if (suppressBlankClickRef.current) {
        suppressBlankClickRef.current = false;
        return;
      }
      const target = e.target as HTMLElement;
      if (target.closest('.canvas-node')) return;
      // Clicking inside the edges SVG (either a hit-proxy or a handle)
      // lands on a child of .canvas-edges. Those children stopPropagate
      // their own onMouseDown, but the click event can still arrive
      // here — ignore it so we don't wipe the selection we just set.
      if (target.closest('.canvas-edges')) return;
      // EdgeStylePanel clicks already stopPropagation in its own handlers,
      // but this belt-and-braces check covers any edge cases where an
      // internal button relies on default bubbling.
      if (target.closest('.edge-style-panel')) return;
      setSelectedNodeIds([]);
      setSelectedEdgeId(null);
    },
    [contextMenu, closeContextMenu, suppressBlankClickRef, setSelectedNodeIds, setSelectedEdgeId],
  );

  const handleRootMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Pan gestures (middle-click, alt-drag, hand tool) take priority
      // over marquee — useCanvas owns those flows and they should keep
      // working from anywhere on the canvas, blank or not.
      const isPanGesture =
        e.button === 1 ||
        (e.button === 0 && e.altKey) ||
        (e.button === 0 && activeTool === 'hand');
      if (isPanGesture) {
        canvasMouseDown(e);
        return;
      }
      // Left-click on truly blank canvas with the select tool → start
      // a marquee. The hook's hit-test runs on mouseup; tiny drags
      // (treated as clicks) report empty hits and fall through to the
      // canvas-click handler that clears selection.
      if (
        e.button === 0 &&
        activeTool === 'select' &&
        isBlankCanvasTarget(e.target)
      ) {
        marquee.begin(e);
        return;
      }
      canvasMouseDown(e);
    },
    [activeTool, canvasMouseDown, isBlankCanvasTarget, marquee],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      canvasMouseMove(e);
    },
    [canvasMouseMove],
  );

  const handleSurfaceDragStart = useCallback(
    (e: React.MouseEvent, node: CanvasNode) => {
      if (e.button === 0 && !e.altKey) isDraggingRef.current = true;
      onDragStart(e, node);
    },
    [onDragStart],
  );

  const handleSurfaceResizeStart = useCallback(
    (
      e: React.MouseEvent,
      nodeId: string,
      width: number,
      height: number,
      edge: ResizeEdge,
      minWidth?: number,
      minHeight?: number,
    ) => {
      if (e.button === 0) isDraggingRef.current = true;
      onResizeStart(e, nodeId, width, height, edge, minWidth, minHeight);
    },
    [onResizeStart],
  );

  const handleWindowDragMove = useCallback(
    (e: MouseEvent) => {
      onDragMove(e as unknown as React.MouseEvent);
      onResizeMove(e as unknown as React.MouseEvent);
    },
    [onDragMove, onResizeMove],
  );

  const handleMouseUp = useCallback(() => {
    const wasNodeGesture = isDraggingRef.current;
    canvasMouseUp();
    onDragEnd();
    onResizeEnd();
    isDraggingRef.current = false;
    if (wasNodeGesture) {
      commitHistory();
      onNodesChange?.(canvasId, pendingParentNodesRef.current ?? nodesRef.current);
      pendingParentNodesRef.current = null;
    }
  }, [canvasId, canvasMouseUp, onDragEnd, onResizeEnd, commitHistory, onNodesChange, nodesRef]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (isDraggingRef.current) handleWindowDragMove(e);
    };
    const onUp = () => {
      if (isDraggingRef.current) handleMouseUp();
    };
    const onBlur = () => {
      if (isDraggingRef.current) handleMouseUp();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [handleWindowDragMove, handleMouseUp]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const onSelectStart = (e: Event) => {
      if (isDraggingRef.current || marquee.active || isEdgeDragging(edgeInteractionState)) {
        e.preventDefault();
      }
    };
    container.addEventListener('selectstart', onSelectStart);
    return () => container.removeEventListener('selectstart', onSelectStart);
  }, [edgeInteractionState, marquee.active, containerRef]);

  const cursorClass = activeTool === 'hand'
    ? ' canvas-container--hand'
    : shapeToolActive ? ' canvas-container--shape'
    : resizingId ? ' canvas-container--resizing'
    : (marquee.active || isDraggingRef.current || isEdgeDragging(edgeInteractionState)) ? ' canvas-container--selecting'
    : '';

  const iframeShieldClass =
    activeTool === 'hand' ||
    moving ||
    panning ||
    marquee.active ||
    shapeDraft !== null ||
    isDraggingRef.current ||
    resizingId !== null ||
    isEdgeDragging(edgeInteractionState)
      ? ' canvas-container--iframe-shielding'
      : '';

  return {
    isDraggingRef,
    pendingParentNodesRef,
    handleCanvasClick,
    handleRootMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleSurfaceDragStart,
    handleSurfaceResizeStart,
    cursorClass,
    iframeShieldClass,
    isEdgeDragging: () => isEdgeDragging(edgeInteractionState),
  };
};
