import { z } from 'zod';
import type { CanvasNode, NodeType } from '../types';
import {
  DEFAULT_FRAME_PADDING,
  DEFAULT_GRID,
  DEFAULT_LAYOUT_GAP,
  findNearestFreeSlot,
  getCanvasBounds,
  rectOf,
} from './layout';
import { bottom, rectContainsCenter, right, type Rect } from './geometry';

export const DEFAULT_DIMENSIONS: Record<NodeType, { title: string; width: number; height: number }> = {
  file: { title: 'Untitled', width: 420, height: 360 },
  terminal: { title: 'Terminal', width: 480, height: 300 },
  frame: { title: 'Frame', width: 720, height: 600 },
  group: { title: 'Group', width: 360, height: 240 },
  agent: { title: 'Agent', width: 520, height: 440 },
  text: { title: 'Text', width: 260, height: 120 },
  iframe: { title: 'Web', width: 520, height: 400 },
  image: { title: 'Image', width: 480, height: 360 },
  shape: { title: 'Shape', width: 200, height: 140 },
  mindmap: { title: 'Mindmap', width: 640, height: 420 },
  plugin: { title: 'Plugin Node', width: 360, height: 240 },
};

export function autoPlace(nodes: CanvasNode[]): { x: number; y: number } {
  if (nodes.length === 0) return { x: 100, y: 100 };
  let maxRight = 0;
  let bestY = 100;
  for (const n of nodes) {
    const right = n.x + n.width;
    if (right > maxRight) {
      maxRight = right;
      bestY = n.y;
    }
  }
  return { x: maxRight + 40, y: bestY };
}

export const placementDirectionSchema = z.enum(['right', 'below', 'left', 'above']);

export const placementIntentSchema = z.object({
  mode: z
    .enum(['append_canvas', 'near_node', 'inside_frame', 'at'])
    .optional()
    .describe('Semantic placement strategy. Omit to append near the right edge of the current canvas.'),
  anchorNodeId: z.string().optional().describe('Anchor node for mode="near_node".'),
  frameId: z.string().optional().describe('Frame node for mode="inside_frame".'),
  direction: placementDirectionSchema.optional().describe('Preferred side for mode="near_node". Default right.'),
  x: z.number().optional().describe('Preferred top-left X for mode="at".'),
  y: z.number().optional().describe('Preferred top-left Y for mode="at".'),
  gap: z.number().min(0).max(500).optional().describe(`Minimum gap around obstacles. Default ${DEFAULT_LAYOUT_GAP}.`),
  padding: z.number().min(0).max(500).optional().describe(`Frame padding for mode="inside_frame". Default ${DEFAULT_FRAME_PADDING}.`),
  avoidOverlap: z.boolean().optional().describe('When true, shift to the nearest free slot. Default true.'),
});

export type PlacementIntent = z.infer<typeof placementIntentSchema>;

function preferredNear(anchor: Rect, size: { width: number; height: number }, direction: z.infer<typeof placementDirectionSchema>, gap: number): { x: number; y: number } {
  switch (direction) {
    case 'left':
      return { x: anchor.x - size.width - gap, y: anchor.y };
    case 'above':
      return { x: anchor.x, y: anchor.y - size.height - gap };
    case 'below':
      return { x: anchor.x, y: bottom(anchor) + gap };
    case 'right':
    default:
      return { x: right(anchor) + gap, y: anchor.y };
  }
}

function frameInnerRect(frame: CanvasNode, padding: number): Rect {
  return {
    x: frame.x + padding,
    y: frame.y + padding,
    width: Math.max(40, frame.width - padding * 2),
    height: Math.max(40, frame.height - padding * 2),
  };
}

export function resolvePlacement(
  nodes: CanvasNode[],
  size: { width: number; height: number },
  explicit: { x?: number; y?: number } = {},
  intent?: PlacementIntent,
): { x: number; y: number } {
  if (explicit.x != null && explicit.y != null) {
    return { x: explicit.x, y: explicit.y };
  }

  const mode = intent?.mode ?? 'append_canvas';
  const gap = intent?.gap ?? DEFAULT_LAYOUT_GAP;
  const avoidOverlap = intent?.avoidOverlap ?? true;
  const obstacles = nodes.map(rectOf);

  if (mode === 'at') {
    if (intent?.x == null || intent.y == null) {
      throw new Error('placement.mode="at" requires placement.x and placement.y');
    }
    const preferred = { x: intent.x, y: intent.y };
    if (!avoidOverlap) return preferred;
    return findNearestFreeSlot(size, obstacles, {
      preferred,
      gap,
      grid: DEFAULT_GRID,
    });
  }

  if (mode === 'near_node') {
    if (!intent?.anchorNodeId) {
      throw new Error('placement.mode="near_node" requires placement.anchorNodeId');
    }
    const anchor = nodes.find((node) => node.id === intent.anchorNodeId);
    if (!anchor) throw new Error(`placement anchor node not found: ${intent.anchorNodeId}`);
    const preferred = preferredNear(rectOf(anchor), size, intent.direction ?? 'right', gap);
    if (!avoidOverlap) return preferred;
    return findNearestFreeSlot(size, obstacles, {
      preferred,
      gap,
      grid: DEFAULT_GRID,
    });
  }

  if (mode === 'inside_frame') {
    if (!intent?.frameId) {
      throw new Error('placement.mode="inside_frame" requires placement.frameId');
    }
    const frame = nodes.find((node) => node.id === intent.frameId);
    if (!frame || frame.type !== 'frame') {
      throw new Error(`placement frame not found: ${intent.frameId}`);
    }
    const inner = frameInnerRect(frame, intent.padding ?? DEFAULT_FRAME_PADDING);
    const preferred = { x: inner.x, y: inner.y };
    const frameRect = rectOf(frame);
    const frameObstacles = nodes
      .filter((node) => node.id !== frame.id && rectContainsCenter(frameRect, rectOf(node)))
      .map(rectOf);
    if (!avoidOverlap) return preferred;
    return findNearestFreeSlot(size, frameObstacles, {
      preferred,
      gap,
      grid: DEFAULT_GRID,
      container: inner,
    });
  }

  const bounds = getCanvasBounds(nodes);
  const preferred = bounds
    ? { x: right(bounds) + gap, y: bounds.y }
    : { x: 100, y: 100 };
  if (!avoidOverlap) return preferred;
  return findNearestFreeSlot(size, obstacles, {
    preferred,
    gap,
    grid: DEFAULT_GRID,
  });
}

/** Prompts shorter than this are passed directly as CLI args; longer ones go to a file. */
export const INLINE_PROMPT_THRESHOLD = 256;
