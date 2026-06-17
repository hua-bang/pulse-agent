import { z } from 'zod';
import type { CanvasTool } from './types';
import { loadCanvas, saveCanvas } from './_shared/canvas-io';
import { broadcastUpdate } from './_shared/broadcast';
import {
  applyLayoutMutations,
  buildLayoutSnapshot,
  DEFAULT_FRAME_PADDING,
  DEFAULT_LAYOUT_GAP,
  getCanvasBounds,
  planCanvasGrid,
  planFrameGrid,
  planPlaceNear,
} from './_shared/layout';

const layoutDirectionSchema = z.enum(['right', 'below', 'left', 'above']);

export function createLayoutTools(workspaceId: string): Record<string, CanvasTool> {
  return {
    canvas_read_layout: {
      name: 'canvas_read_layout',
      description:
        'Read the geometric layout of the canvas: node bboxes, canvas bounds, frame containment, and non-frame overlaps. ' +
        'Use this before organizing nodes or deciding where to add/move something. This is the layout-aware companion to canvas_read_context.',
      inputSchema: z.object({
        workspaceId: z.string().optional().describe('Target workspace ID. Defaults to the current workspace.'),
        gap: z.number().optional().describe('Optional minimum gap to treat near-touching nodes as overlapping. Default 0.'),
      }),
      execute: async (input) => {
        const targetWorkspaceId = (input.workspaceId as string) || workspaceId;
        const canvas = await loadCanvas(targetWorkspaceId);
        if (!canvas) return `Error: workspace not found: ${targetWorkspaceId}`;
        return JSON.stringify({
          ok: true,
          workspaceId: targetWorkspaceId,
          transform: canvas.transform,
          ...buildLayoutSnapshot(canvas.nodes, (input.gap as number | undefined) ?? 0),
        }, null, 2);
      },
    },

    canvas_apply_layout: {
      name: 'canvas_apply_layout',
      description:
        'Apply deterministic layout algorithms instead of hand-calculating x/y coordinates. ' +
        'Use mode="place_near" to place existing nodes near an anchor while avoiding collisions; ' +
        'mode="frame_grid" to arrange nodes inside a frame and auto-fit the frame; ' +
        'mode="canvas_grid" to arrange top-level nodes/frames on the canvas. ' +
        'This is preferred whenever the user asks to organize, tidy, lay out, or generate a structured canvas.',
      inputSchema: z.object({
        mode: z.enum(['place_near', 'frame_grid', 'canvas_grid', 'validate']).describe('Layout operation to run. validate returns a layout snapshot without writing.'),
        nodeIds: z.array(z.string()).optional().describe('Nodes to place/layout. For frame_grid, omitted means current spatial children of the frame. For canvas_grid, omitted means top-level nodes.'),
        anchorNodeId: z.string().optional().describe('Anchor node for place_near. If omitted, placement starts at the canvas bounds.'),
        frameId: z.string().optional().describe('Frame node for frame_grid.'),
        direction: layoutDirectionSchema.optional().describe('Preferred direction for place_near. Default right.'),
        columns: z.number().int().min(1).max(12).optional().describe('Preferred grid column count.'),
        gap: z.number().min(0).max(500).optional().describe(`Gap between nodes. Default ${DEFAULT_LAYOUT_GAP}.`),
        padding: z.number().min(0).max(500).optional().describe(`Frame inner padding. Default ${DEFAULT_FRAME_PADDING}.`),
        fitFrame: z.boolean().optional().describe('For frame_grid, resize the frame to fit children. Default true.'),
        startX: z.number().optional().describe('Canvas-grid start X. Defaults to current canvas min X, or 100.'),
        startY: z.number().optional().describe('Canvas-grid start Y. Defaults to current canvas min Y, or 100.'),
        lockedNodeIds: z.array(z.string()).optional().describe('Nodes canvas_grid should not move.'),
        respectLayoutLocked: z.boolean().optional().describe('When true, canvas_grid skips nodes with data.layoutLocked=true. Default true.'),
      }),
      execute: async (input) => {
        const canvas = await loadCanvas(workspaceId);
        if (!canvas) return 'Error: workspace not found';

        const mode = input.mode as 'place_near' | 'frame_grid' | 'canvas_grid' | 'validate';
        if (mode === 'validate') {
          return JSON.stringify({
            ok: true,
            workspaceId,
            ...buildLayoutSnapshot(canvas.nodes, (input.gap as number | undefined) ?? 0),
          }, null, 2);
        }

        let mutations;
        let meta: Record<string, unknown> = {};
        try {
          if (mode === 'place_near') {
            const nodeIds = (input.nodeIds as string[] | undefined) ?? [];
            if (nodeIds.length === 0) return 'Error: nodeIds is required for place_near';
            const plan = planPlaceNear(canvas.nodes, nodeIds, {
              anchorNodeId: input.anchorNodeId as string | undefined,
              direction: input.direction as 'right' | 'below' | 'left' | 'above' | undefined,
              gap: input.gap as number | undefined,
            });
            mutations = plan.mutations;
          } else if (mode === 'frame_grid') {
            const frameId = input.frameId as string | undefined;
            if (!frameId) return 'Error: frameId is required for frame_grid';
            const plan = planFrameGrid(canvas.nodes, frameId, {
              nodeIds: input.nodeIds as string[] | undefined,
              columns: input.columns as number | undefined,
              gap: input.gap as number | undefined,
              padding: input.padding as number | undefined,
              fitFrame: input.fitFrame as boolean | undefined,
            });
            mutations = plan.mutations;
            meta = { frameId, childIds: plan.childIds, contentBounds: plan.bounds };
          } else {
            const plan = planCanvasGrid(canvas.nodes, {
              nodeIds: input.nodeIds as string[] | undefined,
              columns: input.columns as number | undefined,
              gap: input.gap as number | undefined,
              startX: input.startX as number | undefined,
              startY: input.startY as number | undefined,
              lockedNodeIds: input.lockedNodeIds as string[] | undefined,
              respectLayoutLocked: input.respectLayoutLocked as boolean | undefined,
            });
            mutations = plan.mutations;
            meta = { skippedNodeIds: plan.skippedNodeIds };
          }
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }

        const changedNodeIds = applyLayoutMutations(canvas.nodes, mutations);
        if (changedNodeIds.length > 0) {
          await saveCanvas(workspaceId, canvas);
          broadcastUpdate(workspaceId, changedNodeIds);
        }

        const snapshot = buildLayoutSnapshot(canvas.nodes, 0);
        return JSON.stringify({
          ok: true,
          mode,
          changedNodeIds,
          mutationCount: mutations.length,
          bounds: getCanvasBounds(canvas.nodes),
          overlapCount: snapshot.overlaps.length,
          overlaps: snapshot.overlaps,
          ...meta,
        }, null, 2);
      },
    },

    canvas_resize_node: {
      name: 'canvas_resize_node',
      defer_loading: true,
      description:
        'Resize a node to an explicit width/height. Use this for precise geometry changes; for organizing groups of nodes, prefer canvas_apply_layout.',
      inputSchema: z.object({
        nodeId: z.string().describe('The node to resize.'),
        width: z.number().min(40).describe('New width in canvas px.'),
        height: z.number().min(40).describe('New height in canvas px.'),
        keepCenter: z.boolean().optional().describe('Keep the node center fixed while resizing. Default false.'),
      }),
      execute: async (input) => {
        const nodeId = input.nodeId as string;
        const canvas = await loadCanvas(workspaceId);
        if (!canvas) return 'Error: workspace not found';
        const node = canvas.nodes.find((candidate) => candidate.id === nodeId);
        if (!node) return `Error: node not found: ${nodeId}`;

        const width = input.width as number;
        const height = input.height as number;
        if (input.keepCenter) {
          node.x = Math.round(node.x + (node.width - width) / 2);
          node.y = Math.round(node.y + (node.height - height) / 2);
        }
        node.width = Math.round(width);
        node.height = Math.round(height);
        node.updatedAt = Date.now();

        await saveCanvas(workspaceId, canvas);
        broadcastUpdate(workspaceId, [nodeId]);
        return JSON.stringify({ ok: true, nodeId, width: node.width, height: node.height });
      },
    },
  };
}
