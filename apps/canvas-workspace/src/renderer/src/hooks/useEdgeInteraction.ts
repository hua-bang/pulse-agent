import { useCallback, useEffect, useRef, useState } from 'react';
import type { CanvasEdge, CanvasNode, EdgeEndpoint } from '../types';
import {
  bendFromCursor,
  createDefaultEdge,
  findNodeAtCanvasPoint,
  resolveEndpointToward,
} from '../utils/edgeFactory';

/** Discard connect clicks that never become a deliberate drag. */
const CONNECT_DRAG_MIN_DISTANCE = 6;
export type Point = { x: number; y: number };
export type EdgeInteractionPreviewPatch = Partial<
  Pick<CanvasEdge, 'source' | 'target' | 'bend'>
>;

/**
 * Active edge interaction. Only one can be in-flight at a time; the
 * overlay layer reads this to render the preview line and the handle
 * positions while the drag is live.
 */
export type EdgeInteractionState =
  | {
      kind: 'connect';
      source: EdgeEndpoint;
      /** Where the mouse currently is in canvas coords. */
      cursor: Point;
      /** Node under the cursor, if any — for preview highlighting. */
      hoverNodeId: string | null;
      /** Canvas-px distance moved, used to reject accidental clicks. */
      distance: number;
    }
  | {
      kind: 'move-end';
      edgeId: string;
      /** Which end of the edge is being dragged. */
      end: 'source' | 'target';
      /** Other endpoint, frozen so preview math stays stable. */
      frozen: EdgeEndpoint;
      /** Drag-start endpoint, used to detect a no-op return. */
      original: EdgeEndpoint;
      cursor: Point;
      hoverNodeId: string | null;
      /** Render-only geometry. The canonical edge is written once, on
       *  mouseup, instead of once per pointer event. */
      previewPatch: EdgeInteractionPreviewPatch;
    }
  | {
      kind: 'move-bend';
      edgeId: string;
      /** Frozen resolved endpoints keep bend projection stable. */
      s: Point;
      t: Point;
      cursor: Point;
      /** Base bend plus cursor offset delta avoids a drag-start jump. */
      originBend: number;
      originOffset: number;
      /** Render-only geometry; committed once on mouseup. */
      previewPatch: EdgeInteractionPreviewPatch;
    }
  | {
      kind: 'move-edge';
      edgeId: string;
      /** Only drag-start free points translate; bound ends stay anchored. */
      initialSource: EdgeEndpoint;
      initialTarget: EdgeEndpoint;
      originCursor: Point;
      cursor: Point;
      /** Render-only geometry; committed once on mouseup. */
      previewPatch: EdgeInteractionPreviewPatch;
    };

interface UseEdgeInteractionArgs {
  /** Used for hit-testing and resolving node-bound endpoints. */
  nodes: CanvasNode[];
  /** Render-ordered list; reverse hit-testing picks the visual topmost. */
  sortedNodes: CanvasNode[];
  screenToCanvas: (screenX: number, screenY: number, container: HTMLElement) => Point;
  getContainer: () => HTMLElement | null;
  addEdge: (edge: CanvasEdge) => CanvasEdge;
  updateEdge: (id: string, patch: Partial<CanvasEdge>, addToHistory?: boolean) => void;
  commitHistory: () => void;
  /** Existing edge geometry at gesture start. */
  edges: CanvasEdge[];
  /** Called once after a connect-drag successfully commits a new edge
   *  (ignored for discarded clicks and self-drops). The Canvas wires
   *  this to `setActiveTool('select')` so the user isn't stuck in
   *  connect mode after drawing one arrow. */
  onConnectCommitted?: (edgeId: string) => void;
}

/** Resolve cursor-over-node to an auto anchor; otherwise a free point. */
const cursorToEndpoint = (
  cursor: Point,
  sortedNodes: CanvasNode[],
): { endpoint: EdgeEndpoint; hoverNodeId: string | null } => {
  const hit = findNodeAtCanvasPoint(sortedNodes, cursor.x, cursor.y);
  if (hit) {
    return {
      endpoint: { kind: 'node', nodeId: hit.id, anchor: 'auto' },
      hoverNodeId: hit.id,
    };
  }
  return {
    endpoint: { kind: 'point', x: cursor.x, y: cursor.y },
    hoverNodeId: null,
  };
};

type MoveInteractionState = Exclude<EdgeInteractionState, { kind: 'connect' }>;

const isMoveInteraction = (
  state: EdgeInteractionState | null,
): state is MoveInteractionState => state != null && state.kind !== 'connect';

const endpointsAreEqual = (a: EdgeEndpoint, b: EdgeEndpoint): boolean => {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'point' && b.kind === 'point') {
    return a.x === b.x && a.y === b.y;
  }
  if (a.kind === 'node' && b.kind === 'node') {
    return a.nodeId === b.nodeId && a.anchor === b.anchor;
  }
  return false;
};

/** Project one coalesced pointer position into render-only edge geometry. */
const movePreviewAt = (
  current: MoveInteractionState,
  pt: Point,
  sortedNodes: CanvasNode[],
): MoveInteractionState => {
  if (current.kind === 'move-end') {
    const hit = findNodeAtCanvasPoint(sortedNodes, pt.x, pt.y);
    const endpoint: EdgeEndpoint = hit
      ? { kind: 'node', nodeId: hit.id, anchor: 'auto' }
      : { kind: 'point', x: pt.x, y: pt.y };
    const previewPatch: EdgeInteractionPreviewPatch = endpointsAreEqual(endpoint, current.original)
      ? {}
      : current.end === 'source' ? { source: endpoint } : { target: endpoint };
    return {
      ...current,
      cursor: pt,
      hoverNodeId: hit?.id ?? null,
      previewPatch,
    };
  }

  if (current.kind === 'move-bend') {
    const offset = bendFromCursor(current.s, current.t, pt);
    const bend = current.originBend + (offset - current.originOffset);
    return {
      ...current,
      cursor: pt,
      previewPatch: bend === current.originBend ? {} : { bend },
    };
  }

  const dx = pt.x - current.originCursor.x;
  const dy = pt.y - current.originCursor.y;
  const translateFree = (endpoint: EdgeEndpoint): EdgeEndpoint =>
    endpoint.kind === 'point'
      ? { kind: 'point', x: endpoint.x + dx, y: endpoint.y + dy }
      : endpoint;
  const previewPatch: EdgeInteractionPreviewPatch = {};
  if (dx !== 0 || dy !== 0) {
    if (current.initialSource.kind === 'point') {
      previewPatch.source = translateFree(current.initialSource);
    }
    if (current.initialTarget.kind === 'point') {
      previewPatch.target = translateFree(current.initialTarget);
    }
  }
  return { ...current, cursor: pt, previewPatch };
};

const hasPreviewPatch = (patch: EdgeInteractionPreviewPatch): boolean =>
  patch.source !== undefined || patch.target !== undefined || patch.bend !== undefined;

/**
 * Coordinates the three live edge interactions — drawing a new edge in
 * connect mode, dragging an existing edge's start/end handle, and
 * dragging a bend handle. Encapsulating the global mousemove/mouseup
 * listeners here keeps the Canvas component from accumulating another
 * half-dozen event handlers.
 */
export const useEdgeInteraction = ({
  nodes,
  sortedNodes,
  screenToCanvas,
  getContainer,
  addEdge,
  updateEdge,
  edges,
  onConnectCommitted,
}: UseEdgeInteractionArgs) => {
  const [state, setState] = useState<EdgeInteractionState | null>(null);
  // Mirror of state for use inside the stable window-level listeners,
  // which are installed once per interaction start.
  const stateRef = useRef<EdgeInteractionState | null>(null);
  stateRef.current = state;
  const setInteractionState = useCallback((next: EdgeInteractionState | null) => {
    // Keep window listeners synchronous even when React batches the state
    // update (e.g. mousemove immediately followed by mouseup).
    stateRef.current = next;
    setState(next);
  }, []);

  const pendingMovePointRef = useRef<Point | null>(null);
  const moveFrameRef = useRef<number | null>(null);

  // Fresh view of nodes for the listeners to hit-test against.
  const sortedNodesRef = useRef(sortedNodes);
  sortedNodesRef.current = sortedNodes;

  const screenToCanvasRef = useRef(screenToCanvas);
  screenToCanvasRef.current = screenToCanvas;

  const nodesById = useRef(new Map<string, CanvasNode>());
  nodesById.current = new Map(nodes.map((n) => [n.id, n]));

  /**
   * Compute the mouse position in canvas coordinates. Returns null if
   * the container isn't mounted (shouldn't happen during an active
   * drag, but we defensively bail).
   */
  const toCanvas = useCallback((clientX: number, clientY: number): Point | null => {
    const container = getContainer();
    if (!container) return null;
    return screenToCanvasRef.current(clientX, clientY, container);
  }, [getContainer]);

  const cancelPendingMove = useCallback(() => {
    if (moveFrameRef.current !== null) {
      cancelAnimationFrame(moveFrameRef.current);
      moveFrameRef.current = null;
    }
    pendingMovePointRef.current = null;
  }, []);

  const flushPendingMove = useCallback((publishPreview: boolean): EdgeInteractionState | null => {
    if (moveFrameRef.current !== null) {
      cancelAnimationFrame(moveFrameRef.current);
      moveFrameRef.current = null;
    }
    const pt = pendingMovePointRef.current;
    pendingMovePointRef.current = null;
    const current = stateRef.current;
    if (!pt || !isMoveInteraction(current)) return current;
    const next = movePreviewAt(current, pt, sortedNodesRef.current);
    stateRef.current = next;
    if (publishPreview) setState(next);
    return next;
  }, []);

  const handleMove = useCallback((clientX: number, clientY: number) => {
    const current = stateRef.current;
    if (!current) return;
    const pt = toCanvas(clientX, clientY);
    if (!pt) return;

    if (current.kind === 'connect') {
      const hit = findNodeAtCanvasPoint(sortedNodesRef.current, pt.x, pt.y);
      const dx = pt.x - current.cursor.x;
      const dy = pt.y - current.cursor.y;
      setInteractionState({
        ...current,
        cursor: pt,
        hoverNodeId: hit?.id ?? null,
        distance: current.distance + Math.hypot(dx, dy),
      });
      return;
    }

    // Existing-edge moves are visual-only until mouseup. Coalescing raw
    // pointer events to one preview update per display frame avoids both
    // canonical edge-array churn and redundant SVG reconciliation.
    pendingMovePointRef.current = pt;
    if (moveFrameRef.current !== null) return;
    moveFrameRef.current = requestAnimationFrame(() => {
      moveFrameRef.current = null;
      flushPendingMove(true);
    });
  }, [flushPendingMove, setInteractionState, toCanvas]);

  const handleUp = useCallback(() => {
    // Mouseup may beat the scheduled preview frame. Consume the latest
    // pointer synchronously so the final commit never lags one frame.
    const current = flushPendingMove(false);
    if (!current) return;

    if (current.kind === 'connect') {
      if (current.distance >= CONNECT_DRAG_MIN_DISTANCE) {
        const { endpoint: target } = cursorToEndpoint(current.cursor, sortedNodesRef.current);
        // If the user dropped back on the same node they started
        // from, skip — a self-loop is almost always an accident.
        // Drops on blank space OR a different node both commit.
        const isSelfDrop =
          current.source.kind === 'node' &&
          target.kind === 'node' &&
          current.source.nodeId === target.nodeId;
        if (!isSelfDrop) {
          const edge = addEdge(createDefaultEdge(current.source, target));
          // Hand control back to the caller so it can exit connect mode
          // (tldraw-style: you draw one arrow, then you're back in select).
          onConnectCommitted?.(edge.id);
        }
      }
    } else if (hasPreviewPatch(current.previewPatch)) {
      // The one and only canonical write for this gesture. updateEdge's
      // default addToHistory=true makes the whole drag one undo step.
      updateEdge(current.edgeId, current.previewPatch);
    }

    setInteractionState(null);
  }, [addEdge, flushPendingMove, onConnectCommitted, setInteractionState, updateEdge]);

  /** Abort the gesture (Escape): drop render-only geometry. The canonical
   *  edge was never touched, so cancellation requires no compensating write. */
  const handleCancel = useCallback(() => {
    const current = stateRef.current;
    if (!current) return;
    cancelPendingMove();
    setInteractionState(null);
  }, [cancelPendingMove, setInteractionState]);

  // Window-level listeners are installed only while an interaction is
  // live. Using window (not the canvas container) means the drag keeps
  // tracking when the cursor slips off the canvas — matches the
  // existing node-drag behaviour.
  useEffect(() => {
    if (!state) return;
    const onMove = (e: MouseEvent) => handleMove(e.clientX, e.clientY);
    const onUp = () => handleUp();
    // Window focus loss never delivers the mouseup — finish the gesture
    // like the node-drag handlers do, so the edge isn't left half-dragged.
    const onBlur = () => handleUp();
    // Escape aborts; capture + stopPropagation keeps the canvas-level
    // Escape handler from also deselecting on the same press.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      handleCancel();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [state, handleMove, handleUp, handleCancel]);

  useEffect(() => () => cancelPendingMove(), [cancelPendingMove]);

  /**
   * Begin drawing a new edge. Called by the connect-mode overlay.
   * `clientX/Y` are the screen coords of the mousedown event.
   */
  const beginConnect = useCallback((clientX: number, clientY: number) => {
    const pt = toCanvas(clientX, clientY);
    if (!pt) return;
    const { endpoint: source, hoverNodeId } = cursorToEndpoint(pt, sortedNodesRef.current);
    setInteractionState({
      kind: 'connect',
      source,
      cursor: pt,
      hoverNodeId,
      distance: 0,
    });
  }, [setInteractionState, toCanvas]);

  /**
   * Begin dragging an endpoint of an existing edge. `end === 'source'`
   * moves the start handle, `'target'` moves the end handle.
   */
  const beginMoveEnd = useCallback((
    edgeId: string,
    end: 'source' | 'target',
    clientX: number,
    clientY: number,
  ) => {
    const pt = toCanvas(clientX, clientY);
    if (!pt) return;
    const edge = edges.find((e) => e.id === edgeId);
    if (!edge) return;
    const frozen = end === 'source' ? edge.target : edge.source;
    const original = end === 'source' ? edge.source : edge.target;
    const hit = findNodeAtCanvasPoint(sortedNodesRef.current, pt.x, pt.y);
    setInteractionState({
      kind: 'move-end',
      edgeId,
      end,
      frozen,
      original,
      cursor: pt,
      hoverNodeId: hit?.id ?? null,
      previewPatch: {},
    });
  }, [edges, setInteractionState, toCanvas]);

  /**
   * Begin dragging the bend handle. We snapshot the resolved endpoint
   * positions so the perpendicular projection stays anchored even if
   * the endpoints move slightly mid-drag (e.g. parent frame is being
   * reflowed by something else).
   */
  const beginMoveBend = useCallback((
    edgeId: string,
    s: Point,
    t: Point,
    clientX: number,
    clientY: number,
  ) => {
    const pt = toCanvas(clientX, clientY);
    if (!pt) return;
    const edge = edges.find((e) => e.id === edgeId);
    const originBend = edge?.bend ?? 0;
    // Cursor's offset-from-straight-line at mousedown time — baseline
    // for delta math in handleMove so dragging from anywhere on the
    // curve (not just the midpoint handle) feels continuous.
    const originOffset = bendFromCursor(s, t, pt);
    setInteractionState({
      kind: 'move-bend',
      edgeId,
      s,
      t,
      cursor: pt,
      originBend,
      originOffset,
      previewPatch: {},
    });
  }, [edges, setInteractionState, toCanvas]);

  /**
   * Begin translating the whole edge. Called by the hit-proxy when the
   * user mousedowns on the edge body. We snapshot both endpoints at
   * drag start; only free-point endpoints get translated in handleMove
   * — node-bound endpoints stay anchored to their node so the arrow
   * keeps binding to the shape.
  */
  const beginMoveEdge = useCallback((edgeId: string, clientX: number, clientY: number) => {
    const edge = edges.find((e) => e.id === edgeId);
    if (!edge) return;
    // Translating a fully bound edge cannot change either endpoint. Bail
    // before installing listeners or scheduling preview work.
    if (edge.source.kind === 'node' && edge.target.kind === 'node') return;
    const pt = toCanvas(clientX, clientY);
    if (!pt) return;
    setInteractionState({
      kind: 'move-edge',
      edgeId,
      initialSource: edge.source,
      initialTarget: edge.target,
      originCursor: pt,
      cursor: pt,
      previewPatch: {},
    });
  }, [edges, setInteractionState, toCanvas]);

  /**
   * Resolve the current preview edge's endpoints (for rendering the
   * dashed draft line). Returns null when no connect/move-end drag is
   * active. Handles both free-point endpoints and node-bound auto
   * anchors (computed toward the opposite endpoint).
   */
  const getPreviewEndpoints = useCallback((): { s: Point; t: Point } | null => {
    if (!state) return null;
    if (state.kind === 'connect') {
      const targetPoint: Point = { x: state.cursor.x, y: state.cursor.y };
      const s = resolveEndpointToward(state.source, nodesById.current, targetPoint);
      return { s, t: targetPoint };
    }
    if (state.kind === 'move-end') {
      const frozenPoint = resolveEndpointToward(state.frozen, nodesById.current, state.cursor);
      if (state.end === 'source') {
        return { s: state.cursor, t: frozenPoint };
      }
      return { s: frozenPoint, t: state.cursor };
    }
    return null;
  }, [state]);

  return {
    state,
    beginConnect,
    beginMoveEnd,
    beginMoveBend,
    beginMoveEdge,
    getPreviewEndpoints,
  };
};
