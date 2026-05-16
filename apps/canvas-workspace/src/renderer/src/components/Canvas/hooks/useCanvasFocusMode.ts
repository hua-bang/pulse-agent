import { useCallback, useEffect, useMemo, useState, type MutableRefObject } from 'react';
import type { CanvasNode } from '../../../types';
import { isContainerNode, isInsideContainer } from '../../../utils/frameHierarchy';

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
    opts?: { padding?: number; maxScale?: number },
  ) => void;
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
}: Options) => {
  const [focusModeEnabled, setFocusModeEnabled] = useState(false);
  // ID of the node currently rendered fullscreen. The node stays in
  // `.canvas-transform` (so its iframe / editor / terminal DOM never
  // moves and the embedded page doesn't reload). CSS overrides on
  // `.canvas-transform` and the node itself fill the viewport when
  // this is set — see Canvas/index.css and CanvasNodeView/index.css.
  const [fullscreenNodeId, setFullscreenNodeId] = useState<string | null>(null);

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

  // Drop the fullscreen pin if its node disappears (deleted, workspace
  // swapped, etc.) — leaving it would render an overlay for a node that
  // no longer exists in the tree.
  useEffect(() => {
    if (!fullscreenNodeId) return;
    if (!nodesById.has(fullscreenNodeId)) setFullscreenNodeId(null);
  }, [fullscreenNodeId, nodesById]);

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
  };
};
