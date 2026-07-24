import {
  loadCanvas,
  saveCanvas,
  withWorkspaceLock,
} from './store';
import { notifyCanvasUpdated } from './notifier';
import type { CanvasNode, Result } from './types';

/**
 * Minimal layout toolset for agents driving the canvas from the CLI:
 *   - readLayout: geometry summary (bounds, frames + contained children).
 *   - validateLayout: overlap / frame-containment / readability checks.
 *   - applyFrameGrid: arrange a frame's children in a tidy grid.
 *
 * Containment is geometric (a node belongs to the smallest frame holding its
 * center) because the canvas schema has no explicit frame parenting — this
 * mirrors how the app's renderer decides what moves with a frame.
 */

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const CONTAINER_TYPES = new Set<string>(['frame', 'group']);

const rectOf = (n: CanvasNode): Rect => ({
  x: n.x ?? 0,
  y: n.y ?? 0,
  width: n.width ?? 0,
  height: n.height ?? 0,
});

const centerInside = (inner: Rect, outer: Rect): boolean => {
  const cx = inner.x + inner.width / 2;
  const cy = inner.y + inner.height / 2;
  return cx >= outer.x && cx <= outer.x + outer.width && cy >= outer.y && cy <= outer.y + outer.height;
};

const fullyInside = (inner: Rect, outer: Rect): boolean =>
  inner.x >= outer.x
  && inner.y >= outer.y
  && inner.x + inner.width <= outer.x + outer.width
  && inner.y + inner.height <= outer.y + outer.height;

/** Intersection size along both axes; positive on both = real overlap. */
const intersection = (a: Rect, b: Rect): { w: number; h: number } => ({
  w: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
  h: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
});

const area = (r: Rect): number => r.width * r.height;

/** Smallest frame whose rect holds the node's center, or null. */
function owningFrame(node: CanvasNode, frames: CanvasNode[]): CanvasNode | null {
  let best: CanvasNode | null = null;
  for (const frame of frames) {
    if (frame.id === node.id) continue;
    if (!centerInside(rectOf(node), rectOf(frame))) continue;
    if (!best || area(rectOf(frame)) < area(rectOf(best))) best = frame;
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// read

export interface LayoutNodeSummary {
  id: string;
  type: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutFrameSummary extends LayoutNodeSummary {
  childIds: string[];
}

export interface LayoutSummary {
  workspaceId: string;
  nodeCount: number;
  edgeCount: number;
  bounds: Rect | null;
  /** width / height of the occupied bounds; ~1.6 reads like a window. */
  aspectRatio: number | null;
  frames: LayoutFrameSummary[];
  /** Non-frame nodes not contained by any frame. */
  freeNodes: LayoutNodeSummary[];
}

const summarize = (n: CanvasNode): LayoutNodeSummary => ({
  id: n.id,
  type: n.type,
  title: n.title ?? '',
  ...rectOf(n),
});

export async function readLayout(
  workspaceId: string,
  storeDir?: string,
): Promise<Result<LayoutSummary>> {
  const canvas = await loadCanvas(workspaceId, storeDir);
  if (!canvas) return { ok: false, error: `Workspace not found: ${workspaceId}`, code: 'workspace_not_found' };

  const nodes = canvas.nodes;
  const frames = nodes.filter(n => n.type === 'frame');
  const nonFrames = nodes.filter(n => n.type !== 'frame');

  let bounds: Rect | null = null;
  if (nodes.length > 0) {
    const minX = Math.min(...nodes.map(n => n.x ?? 0));
    const minY = Math.min(...nodes.map(n => n.y ?? 0));
    const maxX = Math.max(...nodes.map(n => (n.x ?? 0) + (n.width ?? 0)));
    const maxY = Math.max(...nodes.map(n => (n.y ?? 0) + (n.height ?? 0)));
    bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  const frameSummaries: LayoutFrameSummary[] = frames.map(f => ({ ...summarize(f), childIds: [] }));
  const byFrameId = new Map(frameSummaries.map(f => [f.id, f]));
  const freeNodes: LayoutNodeSummary[] = [];
  for (const node of nonFrames) {
    const owner = owningFrame(node, frames);
    if (owner) byFrameId.get(owner.id)?.childIds.push(node.id);
    else freeNodes.push(summarize(node));
  }

  return {
    ok: true,
    data: {
      workspaceId,
      nodeCount: nodes.length,
      edgeCount: canvas.edges?.length ?? 0,
      bounds,
      aspectRatio: bounds && bounds.height > 0
        ? Math.round((bounds.width / bounds.height) * 100) / 100
        : null,
      frames: frameSummaries,
      freeNodes,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// validate

export type LayoutIssueKind =
  | 'overlap'
  | 'frame_overlap'
  | 'overflows_frame'
  | 'straddles_frame'
  | 'too_narrow'
  | 'extreme_aspect_ratio';

export interface LayoutIssue {
  kind: LayoutIssueKind;
  nodeIds: string[];
  detail: string;
}

export interface LayoutValidation {
  workspaceId: string;
  ok: boolean;
  checkedNodes: number;
  issues: LayoutIssue[];
  /** True when the overlap listing hit its cap and more pairs exist. */
  truncated: boolean;
}

/** Overlaps smaller than this on either axis are touching, not stacked. */
const OVERLAP_TOLERANCE_PX = 8;
const MIN_READABLE_CONTENT_WIDTH = 240;
const MAX_OVERLAP_ISSUES = 50;

export async function validateLayout(
  workspaceId: string,
  storeDir?: string,
): Promise<Result<LayoutValidation>> {
  const canvas = await loadCanvas(workspaceId, storeDir);
  if (!canvas) return { ok: false, error: `Workspace not found: ${workspaceId}`, code: 'workspace_not_found' };

  const nodes = canvas.nodes;
  const frames = nodes.filter(n => n.type === 'frame');
  const content = nodes.filter(n => !CONTAINER_TYPES.has(n.type));
  const issues: LayoutIssue[] = [];
  let truncated = false;

  const pushOverlap = (kind: 'overlap' | 'frame_overlap', a: CanvasNode, b: CanvasNode) => {
    const overlapCount = issues.filter(i => i.kind === 'overlap' || i.kind === 'frame_overlap').length;
    if (overlapCount >= MAX_OVERLAP_ISSUES) {
      truncated = true;
      return;
    }
    issues.push({
      kind,
      nodeIds: [a.id, b.id],
      detail: `${kind === 'frame_overlap' ? 'frames' : 'nodes'} "${a.title ?? a.id}" and "${b.title ?? b.id}" overlap`,
    });
  };

  for (let i = 0; i < content.length; i++) {
    for (let j = i + 1; j < content.length; j++) {
      const { w, h } = intersection(rectOf(content[i]), rectOf(content[j]));
      if (w > OVERLAP_TOLERANCE_PX && h > OVERLAP_TOLERANCE_PX) pushOverlap('overlap', content[i], content[j]);
    }
  }
  for (let i = 0; i < frames.length; i++) {
    for (let j = i + 1; j < frames.length; j++) {
      const { w, h } = intersection(rectOf(frames[i]), rectOf(frames[j]));
      if (w > OVERLAP_TOLERANCE_PX && h > OVERLAP_TOLERANCE_PX) pushOverlap('frame_overlap', frames[i], frames[j]);
    }
  }

  for (const node of content) {
    const r = rectOf(node);
    for (const frame of frames) {
      const { w, h } = intersection(r, rectOf(frame));
      if (w <= OVERLAP_TOLERANCE_PX || h <= OVERLAP_TOLERANCE_PX) continue;
      if (centerInside(r, rectOf(frame))) {
        if (!fullyInside(r, rectOf(frame))) {
          issues.push({
            kind: 'overflows_frame',
            nodeIds: [node.id, frame.id],
            detail: `node "${node.title ?? node.id}" belongs to frame "${frame.title ?? frame.id}" but sticks out of it`,
          });
        }
      } else {
        issues.push({
          kind: 'straddles_frame',
          nodeIds: [node.id, frame.id],
          detail: `node "${node.title ?? node.id}" half-covers frame "${frame.title ?? frame.id}" without belonging to it`,
        });
      }
      break; // report against the first intersecting frame only
    }

    if ((node.type === 'file' || node.type === 'text') && r.width > 0 && r.width < MIN_READABLE_CONTENT_WIDTH) {
      issues.push({
        kind: 'too_narrow',
        nodeIds: [node.id],
        detail: `${node.type} node "${node.title ?? node.id}" is ${Math.round(r.width)}px wide (< ${MIN_READABLE_CONTENT_WIDTH}px readable minimum)`,
      });
    }
  }

  if (nodes.length >= 4) {
    const minX = Math.min(...nodes.map(n => n.x ?? 0));
    const minY = Math.min(...nodes.map(n => n.y ?? 0));
    const maxX = Math.max(...nodes.map(n => (n.x ?? 0) + (n.width ?? 0)));
    const maxY = Math.max(...nodes.map(n => (n.y ?? 0) + (n.height ?? 0)));
    const w = maxX - minX;
    const h = maxY - minY;
    if (h > 0) {
      const ratio = w / h;
      if (ratio > 3.2 || ratio < 0.4) {
        issues.push({
          kind: 'extreme_aspect_ratio',
          nodeIds: [],
          detail: `board bounds are ${Math.round(w)}x${Math.round(h)} (ratio ${ratio.toFixed(2)}); aim closer to a window-like ~1.6 by wrapping frames into rows`,
        });
      }
    }
  }

  return {
    ok: true,
    data: {
      workspaceId,
      ok: issues.length === 0,
      checkedNodes: nodes.length,
      issues,
      truncated,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// frame-grid

export interface FrameGridOptions {
  columns?: number;
  gap?: number;
  padding?: number;
  /** Resize the frame to hug the arranged grid. Default true. */
  fitFrame?: boolean;
}

export interface FrameGridResult {
  frameId: string;
  movedCount: number;
  frame: { x: number; y: number; width: number; height: number };
}

/**
 * Arrange a frame's (geometric) children into a left-to-right, row-wrapped
 * grid inside the frame. Children keep their own sizes; each row is as tall
 * as its tallest member. Runs the whole read→arrange→save cycle inside the
 * workspace lock and saves once.
 */
export async function applyFrameGrid(
  workspaceId: string,
  frameId: string,
  opts: FrameGridOptions = {},
  storeDir?: string,
): Promise<Result<FrameGridResult>> {
  return withWorkspaceLock(workspaceId, storeDir, async () => {
    const canvas = await loadCanvas(workspaceId, storeDir);
    if (!canvas) return { ok: false as const, error: `Workspace not found: ${workspaceId}`, code: 'workspace_not_found' };

    const frame = canvas.nodes.find(n => n.id === frameId && n.type === 'frame');
    if (!frame) return { ok: false as const, error: `Frame not found: ${frameId}`, code: 'node_not_found' };

    const frames = canvas.nodes.filter(n => n.type === 'frame');
    const children = canvas.nodes
      .filter(n => !CONTAINER_TYPES.has(n.type))
      .filter(n => owningFrame(n, frames)?.id === frameId)
      // Reading order of the current layout, so the grid preserves intent.
      .sort((a, b) => ((a.y ?? 0) - (b.y ?? 0)) || ((a.x ?? 0) - (b.x ?? 0)));

    if (children.length === 0) {
      return {
        ok: true as const,
        data: { frameId, movedCount: 0, frame: rectOf(frame) },
      };
    }

    const gap = Math.max(0, opts.gap ?? 16);
    const padding = Math.max(0, opts.padding ?? 24);
    const columns = Math.max(1, Math.floor(opts.columns ?? Math.ceil(Math.sqrt(children.length))));
    const fitFrame = opts.fitFrame !== false;

    const originX = (frame.x ?? 0) + padding;
    const originY = (frame.y ?? 0) + padding;
    let rowY = originY;
    let rowMaxHeight = 0;
    let maxRowWidth = 0;
    const now = Date.now();

    children.forEach((child, i) => {
      const col = i % columns;
      if (col === 0 && i > 0) {
        rowY += rowMaxHeight + gap;
        rowMaxHeight = 0;
      }
      let x = originX;
      if (col > 0) {
        // Sum of the widths already placed in this row.
        for (let k = i - col; k < i; k++) x += (children[k].width ?? 0) + gap;
      }
      child.x = x;
      child.y = rowY;
      child.updatedAt = now;
      rowMaxHeight = Math.max(rowMaxHeight, child.height ?? 0);
      maxRowWidth = Math.max(maxRowWidth, x + (child.width ?? 0) - originX);
    });
    const totalHeight = rowY + rowMaxHeight - originY;

    if (fitFrame) {
      frame.width = maxRowWidth + padding * 2;
      frame.height = totalHeight + padding * 2;
      frame.updatedAt = now;
    }

    canvas.savedAt = new Date().toISOString();
    await saveCanvas(workspaceId, canvas, storeDir);
    await notifyCanvasUpdated({
      workspaceId,
      nodeIds: [...children.map(c => c.id), frameId],
      kind: 'update',
    });

    return {
      ok: true as const,
      data: {
        frameId,
        movedCount: children.length,
        frame: rectOf(frame),
      },
    };
  });
}
