import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { CanvasNode, CanvasTransform } from '../../../../../../types';
import { OVERVIEW_SCALE_THRESHOLD } from '../../../../runtime/useCanvas';
import { FULLSCREEN_NODE_TYPES } from '../../CanvasNodeView/constants';

// Tight framing for non-fullscreenable nodes (frames, groups, shapes) when
// the user triggers Focus (F) on them.
const CONTAINER_FOCUS_PADDING = 40;
const CONTAINER_FOCUS_MAX_SCALE = 1.5;

const isFocusableNode = (node: CanvasNode): boolean => FULLSCREEN_NODE_TYPES.has(node.type);

interface Options {
  nodes: CanvasNode[];
  nodesById: Map<string, CanvasNode>;
  nodesRef: MutableRefObject<CanvasNode[]>;
  selectedNodeIds: string[];
  handleFocusNode: (
    node: CanvasNode,
    opts?: { padding?: number; maxScale?: number; minScale?: number },
  ) => void;
  getLiveTransform: () => CanvasTransform;
  animateTransform: (next: CanvasTransform) => void;
  setSelectedNodeIds: (ids: string[]) => void;
  setSelectedEdgeId: (id: string | null) => void;
  setHighlightedId: (id: string | null) => void;
}

/**
 * Owns the unified immersive focus (fullscreen) state for the canvas.
 * Focusing a content node stretches it in place inside `.canvas-transform`
 * (so iframes / editors / terminals never remount), glides the camera to it
 * at 100%, dims and blurs the surrounding canvas, and restores the previous
 * viewport on exit.
 */
export const useCanvasFocusMode = ({
  nodes,
  nodesById,
  nodesRef,
  selectedNodeIds,
  handleFocusNode,
  getLiveTransform,
  animateTransform,
  setSelectedNodeIds,
  setSelectedEdgeId,
  setHighlightedId,
}: Options) => {
  // ID of the node currently in immersive focus / fullscreen.
  const [fullscreenNodeId, setFullscreenNodeId] = useState<string | null>(null);
  // Viewport to return to when immersive focus ends, captured on initial entry.
  const fullscreenReturnRef = useRef<CanvasTransform | null>(null);

  const focusableNodes = useMemo(() => nodes.filter(isFocusableNode), [nodes]);
  const focusModeActive = fullscreenNodeId !== null;
  const focusModeAvailable = selectedNodeIds.length === 1;
  const canStepFullscreen = fullscreenNodeId !== null && focusableNodes.length > 1;

  const handleToggleFullscreen = useCallback((nodeId: string) => {
    setFullscreenNodeId((current) => {
      if (current === nodeId) return null;
      return nodeId;
    });
    setSelectedNodeIds([nodeId]);
    setSelectedEdgeId(null);
  }, [setSelectedEdgeId, setSelectedNodeIds]);

  const exitFullscreen = useCallback(() => {
    setFullscreenNodeId(null);
  }, []);

  const toggleFocusMode = useCallback(() => {
    if (fullscreenNodeId) {
      setFullscreenNodeId(null);
      return;
    }
    if (selectedNodeIds.length !== 1) return;
    const node = nodesById.get(selectedNodeIds[0]);
    if (!node) return;
    if (isFocusableNode(node)) {
      setFullscreenNodeId(node.id);
      return;
    }
    handleFocusNode(node, { padding: CONTAINER_FOCUS_PADDING, maxScale: CONTAINER_FOCUS_MAX_SCALE });
  }, [fullscreenNodeId, handleFocusNode, nodesById, selectedNodeIds]);

  // Step through focusable nodes while staying in immersive focus. The
  // original return viewport stays captured so exiting still glides back to
  // where the user started.
  const stepFullscreen = useCallback((direction: 1 | -1) => {
    if (!fullscreenNodeId || focusableNodes.length <= 1) return;
    const currentIndex = focusableNodes.findIndex((n) => n.id === fullscreenNodeId);
    const baseIndex = currentIndex === -1 ? 0 : currentIndex;
    const nextIndex = (baseIndex + direction + focusableNodes.length) % focusableNodes.length;
    const nextNode = focusableNodes[nextIndex];
    if (!nextNode || nextNode.id === fullscreenNodeId) return;
    setFullscreenNodeId(nextNode.id);
    setSelectedNodeIds([nextNode.id]);
    setSelectedEdgeId(null);
    setHighlightedId(nextNode.id);
  }, [focusableNodes, fullscreenNodeId, setHighlightedId, setSelectedEdgeId, setSelectedNodeIds]);

  // Select and frame a node for a navigation (layer click, find, open on
  // canvas). Fullscreen pins the camera to its node: focusing that node
  // again keeps the camera, and focusing another node ends fullscreen first.
  // That exit skips the return glide, or the glide would override the new
  // framing.
  const focusNodeInViewport = useCallback((node: CanvasNode) => {
    setSelectedNodeIds([node.id]);
    setSelectedEdgeId(null);
    setHighlightedId(node.id);
    if (fullscreenNodeId === node.id) return;
    if (fullscreenNodeId) {
      fullscreenReturnRef.current = null;
      setFullscreenNodeId(null);
    }
    // A web node below the overview threshold still shows only its identity
    // card, so focusing one must land where the page itself renders.
    // Never zoom in past 100% (or the current zoom, if higher) to show it.
    const maxScale = Math.max(getLiveTransform().scale, 1);
    const minScale = node.type === 'iframe' ? OVERVIEW_SCALE_THRESHOLD + 0.05 : undefined;
    handleFocusNode(node, { maxScale, minScale });
  }, [
    fullscreenNodeId, getLiveTransform, handleFocusNode,
    setHighlightedId, setSelectedEdgeId, setSelectedNodeIds,
  ]);

  // Drop the fullscreen pin if its node disappears (deleted, workspace
  // swapped, etc.) — leaving it would render an overlay for a node that
  // no longer exists in the tree.
  useEffect(() => {
    if (!fullscreenNodeId) return;
    if (!nodesById.has(fullscreenNodeId)) setFullscreenNodeId(null);
  }, [fullscreenNodeId, nodesById]);

  // Fullscreen camera: put the node's top-left at the viewport origin at
  // 100% zoom. The CSS stretch is anchored to that corner, so the node
  // keeps filling the viewport when the window or dock resizes without
  // any re-measure. Every exit path (chip, Esc, F, backdrop, node removal)
  // clears the id, so the return glide lives here too.
  useEffect(() => {
    if (fullscreenNodeId) {
      const node = nodesRef.current.find((n) => n.id === fullscreenNodeId);
      if (!node) return;
      fullscreenReturnRef.current ??= getLiveTransform();
      animateTransform({ x: -node.x, y: -node.y, scale: 1 });
      return;
    }
    const previous = fullscreenReturnRef.current;
    if (!previous) return;
    fullscreenReturnRef.current = null;
    animateTransform(previous);
  }, [fullscreenNodeId, nodesRef, getLiveTransform, animateTransform]);

  return {
    focusModeActive,
    focusModeAvailable,
    fullscreenNodeId,
    canStepFullscreen,
    toggleFocusMode,
    stepFullscreen,
    handleToggleFullscreen,
    exitFullscreen,
    focusNodeInViewport,
  };
};
