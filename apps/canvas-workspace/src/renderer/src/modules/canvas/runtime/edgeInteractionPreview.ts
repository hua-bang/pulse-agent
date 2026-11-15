import type { CanvasEdge, CanvasNode, EdgeEndpoint } from '../../../types';
import { bendFromCursor, findNodeAtCanvasPoint } from '../model/edgeFactory';

// Gesture state and render-only preview math for useEdgeInteraction.
// Everything here is pure; the hook owns listeners and commits.

export type Point = { x: number; y: number };
export type EdgeInteractionPreviewPatch = Partial<
  Pick<CanvasEdge, 'source' | 'target' | 'bend' | 'curveMode'>
>;

/** The single active edge interaction used to render live previews. */
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
      /** Render-only geometry, committed once on mouseup. */
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
      /** Automatic curves and previously adjusted smooth curves keep cubic
       * geometry; legacy non-zero bends continue using their quadratic path. */
      smoothBend: boolean;
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
      previewPatch: EdgeInteractionPreviewPatch;
    };

/** Resolve cursor-over-node to an auto anchor; otherwise a free point. */
export const cursorToEndpoint = (
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

export const isMoveInteraction = (
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
export const movePreviewAt = (
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
    const previewPatch: EdgeInteractionPreviewPatch =
      bend === current.originBend
        ? {}
        : {
            bend,
            ...(current.smoothBend ? { curveMode: 'smooth' as const } : {}),
          };
    return {
      ...current,
      cursor: pt,
      previewPatch,
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

export const hasPreviewPatch = (patch: EdgeInteractionPreviewPatch): boolean =>
  patch.source !== undefined || patch.target !== undefined || patch.bend !== undefined;
