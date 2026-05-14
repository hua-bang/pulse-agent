import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './index.css';
import { useCanvas } from '../../hooks/useCanvas';
import { useNodes } from '../../hooks/useNodes';
import { useNodeDrag } from '../../hooks/useNodeDrag';
import { useNodeResize, type ResizeEdge } from '../../hooks/useNodeResize';
import { useCanvasContext } from '../../hooks/useCanvasContext';
import { useCanvasFit } from '../../hooks/useCanvasFit';
import { useCanvasKeyboard } from '../../hooks/useCanvasKeyboard';
import { useCanvasSearch } from '../../hooks/useCanvasSearch';
import { useCanvasImagePaste } from '../../hooks/useCanvasImagePaste';
import { useEdgeInteraction } from '../../hooks/useEdgeInteraction';
import { useShapeDraw } from '../../hooks/useShapeDraw';
import { useMarqueeSelect } from '../../hooks/useMarqueeSelect';
import { useAppShell } from '../AppShellProvider';
import type { CanvasNode } from '../../types';
import type { EdgeInteractionState } from '../../hooks/useEdgeInteraction';
import type { PaletteCommand } from '../CommandPalette';
import {
  computeContainerDepths,
  isInsideContainer,
  isContainerNode,
} from '../../utils/frameHierarchy';
import { getNodeDisplayLabel } from '../../utils/nodeLabel';
import { exportMindmapNodeToPng } from '../../utils/mindmapExport';
import type { CanvasNodeRenameRequest } from '../../types/ui-interaction';
import { CanvasSurface } from './CanvasSurface';
import { CanvasOverlays } from './CanvasOverlays';

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

interface CanvasProps {
  canvasId: string;
  canvasName?: string;
  rootFolder?: string;
  onNodesChange?: (canvasId: string, nodes: CanvasNode[]) => void;
  onSelectionChange?: (canvasId: string, selectedNodeIds: string[]) => void;
  focusNodeId?: string;
  onFocusComplete?: () => void;
  deleteNodeId?: string;
  onDeleteComplete?: () => void;
  renameRequest?: CanvasNodeRenameRequest;
  onRenameComplete?: () => void;
  chatPanelOpen?: boolean;
  onChatToggle?: () => void;
  referenceDrawerOpen?: boolean;
  onReferenceToggle?: () => void;
  onPinReferenceNode?: (nodeId: string) => void;
}

export const Canvas = ({
  canvasId,
  canvasName,
  rootFolder,
  onNodesChange,
  onSelectionChange,
  focusNodeId,
  onFocusComplete,
  deleteNodeId,
  onDeleteComplete,
  renameRequest,
  onRenameComplete,
  chatPanelOpen,
  onChatToggle,
  referenceDrawerOpen,
  onReferenceToggle,
  onPinReferenceNode,
}: CanvasProps) => {
  const { confirm, notify, openShortcuts, isOverlayOpen } = useAppShell();
  const [activeTool, setActiveTool] = useState('select');
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [clipboardNodes, setClipboardNodes] = useState<CanvasNode[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [focusModeEnabled, setFocusModeEnabled] = useState(false);
  // ID of the node currently rendered as a fullscreen overlay (covers the
  // canvas viewport, escapes the pan/zoom transform via a portal so the
  // node's editor/terminal state stays mounted). Null when no node is
  // fullscreened.
  const [fullscreenNodeId, setFullscreenNodeId] = useState<string | null>(null);
  const [fullscreenPortalEl, setFullscreenPortalEl] = useState<HTMLDivElement | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasAutoFitted = useRef(false);
  const [contextMenu, setContextMenu] = useState<{
    screenX: number;
    screenY: number;
    canvasX: number;
    canvasY: number;
  } | null>(null);

  // Set to true at the end of a real marquee drag so the click event
  // that fires immediately afterward doesn't fall through to the blank-
  // canvas-click handler and wipe the selection we just made.
  const suppressBlankClickRef = useRef(false);

  // Node drag / resize starts inside node subtrees, but mousemove bubbles
  // through whatever element is currently under the cursor. If that element
  // is an editable text layer (mindmap text, ProseMirror text, etc.), the
  // browser may select/focus text and React's canvas-level move can stop
  // seeing a consistent stream. Track the gesture at the window level too
  // so dragging remains uninterrupted when crossing text.
  const isDraggingRef = useRef(false);
  const nodesRef = useRef<CanvasNode[]>([]);
  const pendingParentNodesRef = useRef<CanvasNode[] | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  const {
    transform,
    setTransform,
    moving,
    panning,
    handleWheel,
    handleMouseDown: canvasMouseDown,
    handleMouseMove: canvasMouseMove,
    handleMouseUp: canvasMouseUp,
    screenToCanvas,
    resetTransform,
  } = useCanvas(activeTool === 'hand');

  const { animating, handleFocusNode, fitAllNodes } = useCanvasFit(containerRef, setTransform);

  const {
    nodes,
    edges,
    loaded,
    externallyEditedIds,
    addNode,
    updateNode,
    removeNode,
    removeNodes,
    moveNode,
    moveNodes,
    resizeNode,
    addEdge,
    updateEdge,
    removeEdge,
    setTransformForSave,
    flushSave,
    commitHistory,
    undo,
    redo,
    duplicateNode,
    pasteNodes,
    groupNodes,
    ungroupNodes,
    wrapNodesInFrame,
  } = useNodes(canvasId, (savedTransform) => {
    hasAutoFitted.current = true;
    setTransform(savedTransform);
  });

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  // Which edge (if any) is in label-edit mode. Driven by dbl-click on
  // the edge body; cleared on blur/Escape/Enter. Stored here (not inside
  // EdgeLabel) so that selecting a different edge or deleting the edge
  // can forcibly end the edit session.
  const [editingEdgeLabelId, setEditingEdgeLabelId] = useState<string | null>(null);

  const focusModeAvailable = selectedNodeIds.length === 1;

  // Indexed lookup for O(1) access by id. Declared before the focus
  // memos below so they can use it without falling back to O(n)
  // `Array.find`, and reused later for the find-bar's match resolver.
  const nodesById = useMemo(() => {
    const m = new Map<string, CanvasNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

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

  // Flush pending saves on window close or component unmount
  useEffect(() => {
    const handler = () => { flushSave(); };
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
      flushSave();
    };
  }, [flushSave]);

  // Only persist transform after data has loaded to avoid saving empty nodes
  useEffect(() => {
    if (!loaded) return;
    setTransformForSave(transform);
  }, [loaded, transform, setTransformForSave]);

  // Auto-fit all nodes into view on initial load
  useEffect(() => {
    if (loaded && !hasAutoFitted.current) {
      hasAutoFitted.current = true;
      if (nodes.length > 0) fitAllNodes(nodes);
    }
  }, [loaded, nodes, fitAllNodes]);

  // Report nodes to parent only after loaded
  useEffect(() => {
    if (!loaded) return;
    if (isDraggingRef.current) {
      pendingParentNodesRef.current = nodes;
      return;
    }
    onNodesChange?.(canvasId, nodes);
  }, [canvasId, nodes, loaded, onNodesChange]);

  // Report selection so adjacent UI, such as the Agent panel, can scope work
  // to the same nodes the user has visually selected.
  useEffect(() => {
    if (!loaded) return;
    onSelectionChange?.(canvasId, selectedNodeIds);
  }, [canvasId, loaded, onSelectionChange, selectedNodeIds]);

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
  }, [focusModeActive, selectedNodeIds, handleFocusNode]);

  // Handle external focus request (e.g. from sidebar layers panel)
  useEffect(() => {
    if (!loaded) return;
    if (!focusNodeId) return;
    const node = nodesRef.current.find((n) => n.id === focusNodeId);
    if (node) {
      setSelectedNodeIds([node.id]);
      setHighlightedId(node.id);
      handleFocusNode(node);
    }
    onFocusComplete?.();
  }, [focusNodeId, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle external delete request (e.g. from sidebar layers context menu)
  useEffect(() => {
    if (!loaded) return;
    if (!deleteNodeId) return;
    if (nodesRef.current.some((n) => n.id === deleteNodeId)) {
      removeNode(deleteNodeId);
      setSelectedNodeIds((ids) => ids.filter((id) => id !== deleteNodeId));
    }
    onDeleteComplete?.();
  }, [deleteNodeId, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!loaded) return;
    if (!renameRequest) return;
    if (renameRequest.workspaceId !== canvasId) return;

    const node = nodesRef.current.find((item) => item.id === renameRequest.nodeId);
    if (node && node.title !== renameRequest.title) {
      updateNode(node.id, { title: renameRequest.title });
    }
    onRenameComplete?.();
  }, [renameRequest, loaded, canvasId, updateNode, onRenameComplete]);

  const requestRemoveNodes = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    const victims = nodesRef.current.filter((node) => idSet.has(node.id));
    if (victims.length === 0) return;

    removeNodes(victims.map((node) => node.id));
    const removedIds = new Set(victims.map((node) => node.id));
    setSelectedNodeIds((current) => current.filter((id) => !removedIds.has(id)));
  }, [removeNodes]);

  const requestRemoveEdge = useCallback(async (id: string) => {
    const edge = edges.find((item) => item.id === id);
    if (!edge) return;

    const accepted = await confirm({
      intent: 'danger',
      title: 'Delete this connection?',
      description: 'This removes the arrow and its label from the canvas.',
      confirmLabel: 'Delete connection',
    });
    if (!accepted) return;

    removeEdge(id);
    setSelectedEdgeId((current) => (current === id ? null : current));
    if (editingEdgeLabelId === id) setEditingEdgeLabelId(null);
    notify({
      tone: 'success',
      title: 'Connection deleted',
      description: edge.label?.trim() ? edge.label : 'Arrow removed from the canvas.',
    });
  }, [edges, confirm, removeEdge, editingEdgeLabelId, notify]);

  useCanvasContext(rootFolder, nodes, canvasName);

  const groupSelectedNodes = useCallback(() => {
    if (selectedNodeIds.length === 0) return;
    const group = groupNodes(selectedNodeIds);
    if (!group) return;
    setSelectedNodeIds([group.id]);
    notify({
      tone: 'success',
      title: 'Nodes grouped',
      description: `Grouped ${selectedNodeIds.length} node${selectedNodeIds.length === 1 ? '' : 's'}.`,
    });
  }, [groupNodes, selectedNodeIds, notify]);

  const ungroupSelectedNodes = useCallback(() => {
    if (selectedNodeIds.length === 0) return;
    const selectedGroups = nodesRef.current.filter((node) => selectedNodeIds.includes(node.id) && node.type === 'group');
    if (selectedGroups.length === 0) return;
    const releasedIds = ungroupNodes(selectedGroups.map((node) => node.id));
    setSelectedNodeIds(releasedIds);
    notify({
      tone: 'success',
      title: selectedGroups.length === 1 ? 'Group dissolved' : 'Groups dissolved',
      description: releasedIds.length > 0
        ? `Released ${releasedIds.length} child node${releasedIds.length === 1 ? '' : 's'}.`
        : 'Removed empty group container.',
    });
  }, [selectedNodeIds, ungroupNodes, notify]);

  const wrapSelectedNodesInFrame = useCallback(() => {
    if (selectedNodeIds.length === 0) return;
    const frame = wrapNodesInFrame(selectedNodeIds);
    if (!frame) return;
    setSelectedNodeIds([frame.id]);
    notify({
      tone: 'success',
      title: 'Frame created',
      description: `Wrapped ${selectedNodeIds.length} node${selectedNodeIds.length === 1 ? '' : 's'} in a new frame.`,
    });
  }, [wrapNodesInFrame, selectedNodeIds, notify]);

  const handleNodeViewportFocus = useCallback((node: CanvasNode) => {
    setSelectedNodeIds([node.id]);
    setHighlightedId(node.id);
    // In focus mode the dedicated reframe effect handles the zoom with
    // tighter padding/maxScale — calling handleFocusNode here too would
    // produce a double reframe at different scales (visible jitter).
    if (!focusModeActive) handleFocusNode(node);
  }, [handleFocusNode, focusModeActive]);

  // Ctrl/Cmd+F "find in canvas". Kept separate from the Cmd+K palette
  // (searchOpen) because Find is iterative — the bar stays open while
  // the user pages through matches. See useCanvasSearch for details.
  const search = useCanvasSearch({ nodes });
  const handleSearchMatchActivate = useCallback((node: CanvasNode) => {
    // Reuse the existing viewport-focus pipeline so the camera pans
    // and the node gets the brief highlight ring. The active match
    // changes via next/prev or query edits — each transition focuses
    // the canvas on that node.
    handleNodeViewportFocus(node);
  }, [handleNodeViewportFocus]);

  useCanvasKeyboard({
    undo, redo, nodes, selectedNodeIds, setSelectedNodeIds,
    selectedEdgeId, setSelectedEdgeId, removeEdge: requestRemoveEdge,
    duplicateNode, clipboardNodes, setClipboardNodes, pasteNodes, groupSelectedNodes, ungroupSelectedNodes,
    removeNodes: requestRemoveNodes,
    moveNodes, commitHistory,
    searchOpen, setSearchOpen,
    findOpen: search.open,
    toggleFindBar: search.toggleBar,
    closeFindBar: search.closeBar,
    findNext: search.next,
    findPrev: search.prev,
    findHasMatches: search.matches.length > 0,
    contextMenu, setContextMenu,
    setHighlightedId, handleFocusNode,
    focusModeEnabled: focusModeActive,
    canToggleFocusMode: focusModeAvailable,
    onToggleFocusMode: toggleFocusMode,
    onExitFocusMode: exitFocusMode,
    fullscreenActive: fullscreenNodeId != null,
    onExitFullscreen: exitFullscreen,
    keyboardLocked: isOverlayOpen,
  });

  useCanvasImagePaste({
    canvasId,
    active: true,
    containerRef,
    screenToCanvas,
    addNode,
    updateNode,
    onCreated: (node) => setSelectedNodeIds([node.id]),
  });

  // Clear highlight after animation
  useEffect(() => {
    if (highlightedId) {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = setTimeout(() => setHighlightedId(null), 1500);
    }
  }, [highlightedId]);

  const handleSearchSelect = handleNodeViewportFocus;

  const handleRemoveNode = useCallback((id: string) => {
    void requestRemoveNodes([id]);
  }, [requestRemoveNodes]);

  const handleSelectNode = useCallback((id: string, mods?: { shift?: boolean; meta?: boolean }) => {
    // Shift-click extends the selection (additive); Cmd/Ctrl-click
    // toggles the clicked id in/out of the selection. Plain click
    // collapses the selection to just this node — but only if it
    // wasn't already selected, so a click on a member of an
    // existing multi-selection preserves the group (matches Figma /
    // Finder semantics and keeps multi-drag from collapsing on the
    // mousedown that initiates it).
    if (mods?.shift || mods?.meta) {
      setSelectedNodeIds((current) =>
        current.includes(id) ? current.filter((cid) => cid !== id) : [...current, id]
      );
    } else {
      setSelectedNodeIds((current) =>
        current.length > 1 && current.includes(id) ? current : [id]
      );
    }
    setSelectedEdgeId(null);
  }, []);

  const { draggingId, draggingIds, snapLines, onDragStart, onDragMove, onDragEnd } = useNodeDrag(
    moveNode, moveNodes, transform.scale, nodes, selectedNodeIds
  );
  const { resizingId, onResizeStart, onResizeMove, onResizeEnd } =
    useNodeResize(resizeNode, transform.scale);

  // sortedNodes is the render order (containers first, non-containers on top,
  // deeper containers over shallower). It doubles as the hit-test stack
  // for edge interactions — we iterate it in reverse so the topmost
  // node under the cursor wins.
  const sortedNodes = useMemo(
    () => {
      const depths = computeContainerDepths(nodes);
      return [...nodes].sort((a, b) => {
        const aIsContainer = isContainerNode(a);
        const bIsContainer = isContainerNode(b);
        if (aIsContainer && !bIsContainer) return -1;
        if (!aIsContainer && bIsContainer) return 1;
        if (aIsContainer && bIsContainer) {
          return (depths.get(a.id) ?? 0) - (depths.get(b.id) ?? 0);
        }
        return 0;
      });
    },
    [nodes]
  );

  const renderGroups = useMemo(() => {
    const containers: CanvasNode[] = [];
    const regular: CanvasNode[] = [];
    for (const node of sortedNodes) {
      if (isContainerNode(node)) containers.push(node);
      else regular.push(node);
    }
    return { containers, regular };
  }, [sortedNodes]);

  const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const getAllNodes = useCallback(() => nodesRef.current, []);

  const getContainer = useCallback(() => containerRef.current, []);

  const isEdgeDragging = useCallback((state: EdgeInteractionState | null) => {
    return state?.kind === 'connect'
      || state?.kind === 'move-end'
      || state?.kind === 'move-bend'
      || state?.kind === 'move-edge';
  }, []);

  const {
    state: edgeInteractionState,
    beginConnect,
    beginMoveEnd,
    beginMoveBend,
    beginMoveEdge,
    getPreviewEndpoints,
  } = useEdgeInteraction({
    nodes,
    sortedNodes,
    screenToCanvas,
    getContainer,
    addEdge,
    updateEdge,
    commitHistory,
    edges,
    // After the user commits one arrow, hop back to the select tool and
    // auto-select the new edge so the style panel is immediately
    // available. Matches tldraw's "draw one arrow, then edit" flow and
    // fixes the "cursor is still in connect mode, hard to adjust the
    // nodes around it" feedback.
    onConnectCommitted: (edgeId) => {
      setActiveTool('select');
      setSelectedEdgeId(edgeId);
      setSelectedNodeIds([]);
    },
  });

  const handleEdgeHandleMouseDown = useCallback(
    (
      edgeId: string,
      handle: 'source' | 'target' | 'bend',
      e: React.MouseEvent,
      ctx: { s: { x: number; y: number }; t: { x: number; y: number } },
    ) => {
      if (handle === 'bend') {
        beginMoveBend(edgeId, ctx.s, ctx.t, e.clientX, e.clientY);
      } else {
        beginMoveEnd(edgeId, handle, e.clientX, e.clientY);
      }
    },
    [beginMoveBend, beginMoveEnd],
  );

  const handleConnectOverlayMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      beginConnect(e.clientX, e.clientY);
    },
    [beginConnect],
  );

  const {
    draft: shapeDraft,
    handleOverlayMouseDown: handleShapeOverlayMouseDown,
    isActive: shapeToolActive,
  } = useShapeDraw({
    activeTool,
    screenToCanvas,
    getContainer,
    addNode,
    updateNode,
    // Drop back to the select tool and select the committed shape so the
    // user can immediately restyle it via the ShapeStylePicker.
    onCommitted: (node) => {
      setActiveTool('select');
      setSelectedNodeIds([node.id]);
      setSelectedEdgeId(null);
    },
  });

  const handleEdgeBodyMouseDown = useCallback(
    (edgeId: string, e: React.MouseEvent) => {
      if (e.button !== 0) return;
      beginMoveEdge(edgeId, e.clientX, e.clientY);
    },
    [beginMoveEdge],
  );

  const handleMarqueeSelect = useCallback(
    (ids: string[], mods: { shift: boolean; meta: boolean }) => {
      // Suppress the click event that fires right after a real drag
      // (otherwise the blank-canvas click handler would clear what we
      // just selected). A zero-distance "drag" still falls through to
      // the click handler — that's how a plain click on blank canvas
      // continues to clear the selection.
      if (ids.length > 0) suppressBlankClickRef.current = true;

      if (mods.shift || mods.meta) {
        // The modifier explicitly says "extend", so even an empty-hit
        // click on blank canvas must NOT collapse the existing
        // selection. Suppress the trailing click handler regardless of
        // the hit count.
        suppressBlankClickRef.current = true;
        // Toggle each hit id in/out of the selection so a marquee with
        // shift extends the current group and a second pass over the
        // same nodes deselects them.
        setSelectedNodeIds((current) => {
          const next = new Set(current);
          for (const id of ids) {
            if (next.has(id)) next.delete(id);
            else next.add(id);
          }
          return Array.from(next);
        });
        if (ids.length > 0) setSelectedEdgeId(null);
        return;
      }

      // Plain marquee replaces the selection. An empty hit set on a
      // tiny drag falls through to the click handler that clears
      // selection — we don't double-clear here.
      if (ids.length > 0) {
        setSelectedNodeIds(ids);
        setSelectedEdgeId(null);
      }
    },
    []
  );

  const marquee = useMarqueeSelect({
    // Only the plain select tool should own blank-canvas drags. Connect
    // and shape modes mount their own full-canvas overlays that already
    // intercept mousedown, so the redundant `activeTool === 'connect'`
    // check is intentionally omitted — TS narrows it away.
    enabled: activeTool === 'select' && !shapeToolActive,
    screenToCanvas,
    getContainer,
    nodes,
    onSelect: handleMarqueeSelect,
  });

  const handleEdgeBodyDoubleClick = useCallback(
    (edgeId: string) => {
      // Ensure the edge is selected before editing so the style panel
      // stays in sync with the edge the user is labeling.
      setSelectedEdgeId(edgeId);
      setSelectedNodeIds([]);
      setEditingEdgeLabelId(edgeId);
    },
    [],
  );

  const handleCommitEditEdgeLabel = useCallback(
    (edgeId: string, label: string) => {
      // Normalize: empty or whitespace-only labels clear the field back
      // to `undefined`, keeping the stored data clean (and making the
      // label chip disappear from the overlay).
      const trimmed = label.trim();
      updateEdge(edgeId, { label: trimmed.length > 0 ? trimmed : undefined });
      setEditingEdgeLabelId(null);
    },
    [updateEdge],
  );

  const handleCancelEditEdgeLabel = useCallback(() => {
    setEditingEdgeLabelId(null);
  }, []);

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
    [isBlankCanvasTarget, screenToCanvas]
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!isBlankCanvasTarget(e.target)) return;
      if (!containerRef.current) return;
      const pos = screenToCanvas(e.clientX, e.clientY, containerRef.current);
      setContextMenu({ screenX: e.clientX, screenY: e.clientY, canvasX: pos.x, canvasY: pos.y });
    },
    [isBlankCanvasTarget, screenToCanvas]
  );

  const handleCreateNode = useCallback(
    (type: 'file' | 'terminal' | 'frame' | 'group' | 'agent' | 'text' | 'iframe' | 'mindmap') => {
      if (!contextMenu) return;
      const node = addNode(type, contextMenu.canvasX, contextMenu.canvasY);
      setSelectedNodeIds([node.id]);
      setContextMenu(null);
    },
    [addNode, contextMenu]
  );

  const handleExportMindmapImage = useCallback(
    async (nodeId: string) => {
      const node = nodesRef.current.find((item) => item.id === nodeId);
      const api = window.canvasWorkspace?.file;
      if (!node || node.type !== 'mindmap' || !api) return;

      notify({
        tone: 'loading',
        title: 'Exporting mindmap...',
        description: getNodeDisplayLabel(node),
      });

      try {
        const image = await exportMindmapNodeToPng(node);
        const result = await api.exportImage(image.fileName, image.data, 'png');
        if (!result.ok) {
          if (result.canceled) {
            notify({
              tone: 'info',
              title: 'Export canceled',
              description: getNodeDisplayLabel(node),
            });
            return;
          }
          throw new Error(result.error ?? 'The image could not be saved.');
        }
        notify({
          tone: 'success',
          title: 'Mindmap image exported',
          description: result.filePath ?? image.fileName,
        });
      } catch (err) {
        notify({
          tone: 'error',
          title: 'Mindmap export failed',
          description: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [notify],
  );

  const handleToolbarAddNode = useCallback(
    (type: 'file' | 'terminal' | 'frame' | 'group' | 'agent' | 'text' | 'iframe' | 'mindmap') => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pos = screenToCanvas(rect.left + rect.width / 2, rect.top + rect.height / 2, containerRef.current);
      const halfW =
        type === 'file' ? 210
        : type === 'terminal' ? 240
        : type === 'agent' ? 260
        : type === 'text' ? 130
        : type === 'iframe' ? 260
        : type === 'mindmap' ? 320
        : 300;
      const halfH =
        type === 'frame' ? 200
        : type === 'group' ? 120
        : type === 'text' ? 60
        : type === 'iframe' ? 200
        : type === 'mindmap' ? 210
        : 150;
      const node = addNode(type, pos.x - halfW, pos.y - halfH);
      setSelectedNodeIds([node.id]);
    },
    [addNode, screenToCanvas]
  );

  // Command catalog for Cmd+K. Built lazily so each command captures
  // the latest selection / tool / chat state — the palette is only
  // mounted while open, so the cost of rebuilding on every render is
  // negligible compared to the clarity of inlining the bindings here.
  const paletteCommands = useMemo<PaletteCommand[]>(() => {
    const selectionCount = selectedNodeIds.length;
    const list: PaletteCommand[] = [
      // Selection-dependent commands (rendered first when active so
      // batch operations are one keypress away from a multi-selection).
      {
        id: 'duplicate-selection',
        group: 'edit',
        title: selectionCount > 1
          ? `Duplicate ${selectionCount} selected nodes`
          : 'Duplicate selected node',
        shortcut: 'Cmd+D',
        enabled: selectionCount > 0,
        run: () => {
          const created: string[] = [];
          for (const id of selectedNodeIds) {
            const copy = duplicateNode(id);
            if (copy) created.push(copy.id);
          }
          if (created.length > 0) setSelectedNodeIds(created);
        },
      },
      {
        id: 'delete-selection',
        group: 'edit',
        title: selectionCount > 1
          ? `Delete ${selectionCount} selected nodes`
          : 'Delete selected node',
        shortcut: 'Del',
        enabled: selectionCount > 0,
        run: () => {
          void requestRemoveNodes(selectedNodeIds);
        },
      },
      {
        id: 'group-selection',
        group: 'edit',
        title: selectionCount > 1
          ? `Group ${selectionCount} selected nodes`
          : 'Group selected node',
        shortcut: 'Cmd+G',
        aliases: ['group', 'bundle'],
        enabled: selectionCount > 0,
        run: () => {
          groupSelectedNodes();
        },
      },
      {
        id: 'ungroup-selection',
        group: 'edit',
        title: 'Ungroup selected group',
        shortcut: 'Cmd+Shift+G',
        aliases: ['ungroup', 'dissolve group', 'release group'],
        enabled: selectedNodeIds.some((id) => nodesRef.current.some((node) => node.id === id && node.type === 'group')),
        run: () => {
          ungroupSelectedNodes();
        },
      },
      {
        id: 'wrap-selection-in-frame',
        group: 'edit',
        title: selectionCount > 1
          ? `Wrap ${selectionCount} selected nodes in frame`
          : 'Wrap selected node in frame',
        aliases: ['frame', 'wrap'],
        enabled: selectionCount > 0,
        run: () => {
          wrapSelectedNodesInFrame();
        },
      },
      {
        id: 'pin-reference',
        group: 'view',
        title: selectionCount === 1 ? 'Pin selected node as reference' : 'Pin node as reference',
        aliases: ['reference', 'pin', 'context'],
        enabled: selectionCount === 1 && !!onPinReferenceNode,
        run: () => {
          const [nodeId] = selectedNodeIds;
          if (nodeId) onPinReferenceNode?.(nodeId);
        },
      },
      {
        id: 'toggle-focus-mode',
        group: 'view',
        title: focusModeActive ? 'Exit Focus mode' : 'Focus selected node',
        shortcut: 'F',
        aliases: ['focus', 'spotlight', 'dim'],
        enabled: focusModeActive || focusModeAvailable,
        run: toggleFocusMode,
      },
      // Create — one entry per node type. Aliases catch the common
      // alternative names users type ("markdown" → file, "ai" → agent).
      {
        id: 'create-note',
        group: 'create',
        title: 'New note',
        hint: 'Markdown file backed by disk',
        aliases: ['file', 'markdown', 'doc', 'md'],
        run: () => handleToolbarAddNode('file'),
      },
      {
        id: 'create-agent',
        group: 'create',
        title: 'Create agent',
        hint: 'Run an AI coding agent in a PTY',
        aliases: ['ai', 'chat', 'assistant', 'claude'],
        run: () => handleToolbarAddNode('agent'),
      },
      {
        id: 'create-text',
        group: 'create',
        title: 'Add text',
        aliases: ['label', 'sticky', 'note'],
        run: () => handleToolbarAddNode('text'),
      },
      {
        id: 'create-frame',
        group: 'create',
        title: 'Add frame',
        hint: 'Named spatial container',
        aliases: ['section', 'box', 'container'],
        run: () => handleToolbarAddNode('frame'),
      },
      {
        id: 'create-link',
        group: 'create',
        title: 'Web page',
        hint: 'URL, HTML, AI, or blank page',
        aliases: ['iframe', 'web', 'url', 'browser', 'blank', 'page', 'link'],
        run: () => handleToolbarAddNode('iframe'),
      },
      {
        id: 'create-mindmap',
        group: 'create',
        title: 'New mindmap',
        aliases: ['tree', 'topic', 'outline'],
        run: () => handleToolbarAddNode('mindmap'),
      },
      // Navigate / View
      {
        id: 'fit-all',
        group: 'navigate',
        title: 'Fit all nodes in view',
        hint: 'Zoom and center to show every node',
        aliases: ['zoom', 'overview', 'show all'],
        enabled: nodesRef.current.length > 0,
        run: () => fitAllNodes(nodesRef.current),
      },
      {
        id: 'reset-zoom',
        group: 'navigate',
        title: 'Reset zoom to 100%',
        aliases: ['1:1', 'actual size'],
        run: () => resetTransform(),
      },
      {
        id: 'toggle-reference',
        group: 'view',
        title: referenceDrawerOpen ? 'Hide reference drawer' : 'Show reference drawer',
        aliases: ['reference', 'ref', 'drawer', 'context'],
        enabled: !!onReferenceToggle,
        run: () => onReferenceToggle?.(),
      },
      {
        id: 'toggle-chat',
        group: 'view',
        title: chatPanelOpen ? 'Hide chat panel' : 'Show chat panel',
        shortcut: 'Cmd+Shift+A',
        aliases: ['ai', 'sidebar', 'assistant'],
        enabled: !!onChatToggle,
        run: () => onChatToggle?.(),
      },
      // Help
      {
        id: 'shortcuts',
        group: 'help',
        title: 'Show keyboard shortcuts',
        shortcut: '?',
        aliases: ['keys', 'bindings', 'cheatsheet'],
        run: () => openShortcuts(),
      },
    ];
    return list;
  }, [
    selectedNodeIds,
    duplicateNode,
    requestRemoveNodes,
    groupSelectedNodes,
    ungroupSelectedNodes,
    wrapSelectedNodesInFrame,
    handleToolbarAddNode,
    fitAllNodes,
    resetTransform,
    chatPanelOpen,
    onChatToggle,
    referenceDrawerOpen,
    onReferenceToggle,
    onPinReferenceNode,
    openShortcuts,
    focusModeActive,
    focusModeAvailable,
    toggleFocusMode,
  ]);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      if (contextMenu) setContextMenu(null);
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
    [contextMenu]
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
    [activeTool, canvasMouseDown, isBlankCanvasTarget, marquee]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      canvasMouseMove(e);
    },
    [canvasMouseMove]
  );

  const handleSurfaceDragStart = useCallback((e: React.MouseEvent, node: CanvasNode) => {
    if (e.button === 0 && !e.altKey) isDraggingRef.current = true;
    onDragStart(e, node);
  }, [onDragStart]);

  const handleSurfaceResizeStart = useCallback((
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
  }, [onResizeStart]);

  const handleWindowDragMove = useCallback(
    (e: MouseEvent) => {
      onDragMove(e as unknown as React.MouseEvent);
      onResizeMove(e as unknown as React.MouseEvent);
    },
    [onDragMove, onResizeMove]
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
  }, [canvasId, canvasMouseUp, onDragEnd, onResizeEnd, commitHistory, onNodesChange]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (isDraggingRef.current) handleWindowDragMove(e);
    };
    const onUp = () => {
      if (isDraggingRef.current) handleMouseUp();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
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
  }, [edgeInteractionState, isEdgeDragging, marquee.active]);

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

  if (!loaded) {
    return (
      <div className="canvas-container">
        <div className="canvas-empty-hint">
          <div className="hint-text">Loading workspace...</div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`canvas-container${cursorClass}${iframeShieldClass}`}
      onWheel={handleWheel}
      onMouseDown={handleRootMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => {
        if (!isDraggingRef.current && !isEdgeDragging(edgeInteractionState)) {
          handleMouseUp();
        }
      }}
      onDragStart={(e) => e.preventDefault()}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      onClick={handleCanvasClick}
      data-focus-mode={focusModeActive ? 'on' : undefined}
      data-fullscreen={fullscreenNodeId ? 'on' : undefined}
    >
      <div className="canvas-grid" />

      <CanvasSurface
        transform={transform}
        animating={animating}
        moving={moving}
        renderGroups={renderGroups}
        nodes={nodes}
        edges={edges}
        rootFolder={rootFolder}
        canvasId={canvasId}
        canvasName={canvasName}
        draggingId={draggingId}
        draggingIds={draggingIds}
        resizingId={resizingId}
        selectedNodeIdSet={selectedNodeIdSet}
        selectedEdgeId={selectedEdgeId}
        highlightedId={highlightedId}
        externallyEditedIds={externallyEditedIds}
        edgeInteractionState={edgeInteractionState}
        edgePreviewEndpoints={getPreviewEndpoints()}
        shapeDraft={shapeDraft}
        marqueeRect={marquee.rect}
        snapLines={snapLines}
        focusedNodeIds={focusedNodeIds}
        focusContextNodeIds={focusContextNodeIds}
        focusModeEnabled={focusModeActive}
        onDragStart={handleSurfaceDragStart}
        onResizeStart={handleSurfaceResizeStart}
        onUpdate={updateNode}
        onAutoResize={resizeNode}
        onRemove={handleRemoveNode}
        onSelect={handleSelectNode}
        onExportMindmapImage={handleExportMindmapImage}
        onFocus={handleNodeViewportFocus}
        onReference={onPinReferenceNode}
        onUngroupSelectedGroups={ungroupSelectedNodes}
        fullscreenNodeId={fullscreenNodeId}
        fullscreenPortalEl={fullscreenPortalEl}
        onToggleFullscreen={handleToggleFullscreen}
        onSelectEdge={(id) => {
          setSelectedEdgeId(id);
          if (id) setSelectedNodeIds([]);
        }}
        onEdgeHandleMouseDown={handleEdgeHandleMouseDown}
        onEdgeBodyMouseDown={handleEdgeBodyMouseDown}
        onEdgeBodyDoubleClick={handleEdgeBodyDoubleClick}
        getAllNodes={getAllNodes}
      />

      {/* Portal target for the fullscreen node overlay. Sits outside
          `.canvas-transform` so the portaled node escapes the pan/zoom
          containing block; covers the viewport via CSS only when a node
          is fullscreened (otherwise it's display:none and inert). */}
      <div
        ref={setFullscreenPortalEl}
        className="canvas-fullscreen-portal"
        data-active={fullscreenNodeId ? 'on' : undefined}
      />

      <CanvasOverlays
        nodes={nodes}
        contextMenu={contextMenu}
        searchOpen={searchOpen}
        activeTool={activeTool}
        scale={transform.scale}
        selectionCount={selectedNodeIds.length}
        chatPanelOpen={chatPanelOpen}
        onChatToggle={onChatToggle}
        referenceDrawerOpen={referenceDrawerOpen}
        onReferenceToggle={onReferenceToggle}
        onCreateNode={handleCreateNode}
        onCloseContextMenu={() => setContextMenu(null)}
        onOpenShortcuts={openShortcuts}
        onToolChange={setActiveTool}
        onAddNode={handleToolbarAddNode}
        onResetTransform={resetTransform}
        paletteCommands={paletteCommands}
        onSearchSelect={handleSearchSelect}
        onCloseSearch={() => setSearchOpen(false)}
        findSearch={search}
        findNodesById={nodesById}
        onFindMatchActivate={handleSearchMatchActivate}
        onConnectMouseDown={handleConnectOverlayMouseDown}
        shapeToolActive={shapeToolActive}
        onShapeMouseDown={handleShapeOverlayMouseDown}
        selectedEdge={edges.find((e) => e.id === selectedEdgeId) ?? null}
        transform={transform}
        onUpdateEdge={(id, patch) => {
          // Style mutations are single-step edits; commit to history
          // by default so undo reverses one color/width change at a time.
          updateEdge(id, patch);
        }}
        onRemoveEdge={(id) => {
          void requestRemoveEdge(id);
        }}
        edges={edges}
        editingEdgeLabelId={editingEdgeLabelId}
        onStartEditEdgeLabel={handleEdgeBodyDoubleClick}
        onCommitEditEdgeLabel={handleCommitEditEdgeLabel}
        onCancelEditEdgeLabel={handleCancelEditEdgeLabel}
        focusModeEnabled={focusModeActive}
      />
    </div>
  );
};
