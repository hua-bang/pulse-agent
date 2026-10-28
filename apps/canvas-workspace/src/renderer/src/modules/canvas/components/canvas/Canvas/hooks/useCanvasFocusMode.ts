import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { CanvasNode, CanvasTransform } from '../../../../../../types';
import { isContainerNode, isInsideContainer } from '../../../../../../utils/frameHierarchy';
import { OVERVIEW_SCALE_THRESHOLD } from '../../../../runtime/useCanvas';

// Focus-mode reframe sizing. Padding leaves breathing room around the
// focused node so siblings can peek in at the edges (Heptabase-style),
// and the maxScale cap prevents tiny nodes from being magnified into
// blurry monsters.
const FOCUS_MODE_PADDING = 120;
const FOCUS_MODE_MAX_SCALE = 1.2;

// Stable empty-set reference handed to child components when focus mode
// is off. Reusing the same instance lets memoized consumers
// (CanvasNodeView, CanvasEdgesLayer) skip re-renders that would
// otherwise fire on every parent update. Treated as immutable by
// convention — never mutated after creation.
const EMPTY_FOCUS_SET: Set<string> = new Set();

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
 * Owns the focus-mode + fullscreen state for the canvas. Exposes the
 * derived id sets used by `CanvasSurface` and the keyboard hook, plus
 * the toggle/exit callbacks wired into the palette, keyboard, and chip.
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
  const [focusModeEnabled, setFocusModeEnabled] = useState(false);
  // ID of the node currently rendered fullscreen. Fullscreen is an
  // in-place focus: the node stays in `.canvas-transform` (so its iframe /
  // editor / terminal DOM never moves and the embedded page doesn't
  // reload), the camera glides to it at 100%, and CSS stretches its box to
  // the viewport while the rest of the canvas dims behind it. The stretch is
  // display-only; the stored size never changes. See Canvas/index.css and
  // CanvasNodeView/index.css.
  const [fullscreenNodeId, setFullscreenNodeId] = useState<string | null>(null);
  // Viewport to return to when fullscreen ends, captured on entry.
  const fullscreenReturnRef = useRef<CanvasTransform | null>(null);

  const focusModeAvailable = selectedNodeIds.length === 1;

  // When focus mode is off we don't need to compute anything — every
  // node renders as 'neutral'. Skipping the work avoids re-running the
  // O(n²) container-descendant scan below on every drag/edit (the
  // `nodes` array identity changes constantly), which is the dominant
  // cost on large canvases.
  const focusedNodeIds = useMemo(() => {
    if (!focusModeEnabled) return EMPTY_FOCUS_SET;
    // `selectedNodeIds` is already the authoritative source — the old
    // `nodes.find` check only validated existence, which is guaranteed
    // by the selection state machine and the cleanup effect that
    // exits focus mode whenever the selection isn't exactly one node.
    return new Set<string>(selectedNodeIds);
  }, [focusModeEnabled, selectedNodeIds]);

  const focusContextNodeIds = useMemo(() => {
    if (!focusModeEnabled) return EMPTY_FOCUS_SET;

    const context = new Set<string>();

    for (const id of selectedNodeIds) {
      const node = nodesById.get(id);
      if (!node) continue;

      // Only when the focused node is itself a frame/group do its
      // descendants stay visible — focusing a container clearly means
      // "I want to inspect what's inside it", so dimming the children
      // would defeat the point. For regular nodes (files, text, etc.)
      // we keep focus strictly on the selected node — edge neighbors
      // and parent frames all get dimmed so the user has exactly one
      // bright card on the canvas at a time.
      if (isContainerNode(node)) {
        for (const candidate of nodes) {
          if (candidate.id === node.id) continue;
          if (isInsideContainer(candidate, node)) {
            context.add(candidate.id);
          }
        }
      }
    }

    for (const id of selectedNodeIds) context.delete(id);
    return context;
  }, [focusModeEnabled, nodes, nodesById, selectedNodeIds]);

  const focusModeActive = focusModeEnabled && focusedNodeIds.size > 0;

  const exitFocusMode = useCallback(() => {
    setFocusModeEnabled(false);
  }, []);

  const toggleFocusMode = useCallback(() => {
    setFocusModeEnabled((current) => {
      if (current) return false;
      return focusModeAvailable;
    });
  }, [focusModeAvailable]);

  const handleToggleFullscreen = useCallback((nodeId: string) => {
    setFullscreenNodeId((current) => (current === nodeId ? null : nodeId));
  }, []);

  const exitFullscreen = useCallback(() => {
    setFullscreenNodeId(null);
  }, []);

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
    // In focus mode the dedicated reframe effect handles the zoom with
    // tighter padding/maxScale — calling handleFocusNode here too would
    // produce a double reframe at different scales (visible jitter).
    if (focusModeActive) return;
    // A web node below the overview threshold still shows only its identity
    // card, so focusing one must land where the page itself renders.
    // Never zoom in past 100% (or the current zoom, if higher) to show it.
    const maxScale = Math.max(getLiveTransform().scale, 1);
    const minScale = node.type === 'iframe' ? OVERVIEW_SCALE_THRESHOLD + 0.05 : undefined;
    handleFocusNode(node, { maxScale, minScale });
  }, [
    focusModeActive, fullscreenNodeId, getLiveTransform, handleFocusNode,
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
  // any re-measure. Every exit path (chip, Esc, backdrop, node removal)
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

  // Focus mode is single-selection only — extending the selection
  // (shift-click, marquee-add, Cmd+A, etc.) exits focus mode rather
  // than ambiguously focusing a group of cards.
  useEffect(() => {
    if (selectedNodeIds.length !== 1) setFocusModeEnabled(false);
  }, [selectedNodeIds]);

  // Heptabase-style: when focus mode is engaged, auto-reframe the
  // viewport so the focused node sits comfortably centered. Re-fires on
  // selection change so click-to-refocus glides between cards instead
  // of leaving the viewport pinned to whatever was visible first. Reads
  // the latest nodes via ref so an in-flight drag doesn't trigger a
  // reframe loop.
  useEffect(() => {
    if (!focusModeActive) return;
    if (selectedNodeIds.length !== 1) return;
    const node = nodesRef.current.find((n) => n.id === selectedNodeIds[0]);
    if (node) handleFocusNode(node, { padding: FOCUS_MODE_PADDING, maxScale: FOCUS_MODE_MAX_SCALE });
  }, [focusModeActive, selectedNodeIds, handleFocusNode, nodesRef]);

  return {
    focusModeEnabled,
    focusModeActive,
    focusModeAvailable,
    focusedNodeIds,
    focusContextNodeIds,
    fullscreenNodeId,
    toggleFocusMode,
    exitFocusMode,
    handleToggleFullscreen,
    exitFullscreen,
    focusNodeInViewport,
  };
};
