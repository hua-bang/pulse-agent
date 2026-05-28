import { z } from 'zod';
import type { CanvasNode, CanvasTool } from './types';
import { loadCanvas, saveCanvas } from './_shared/canvas-io';
import { broadcastUpdate } from './_shared/broadcast';
import { autoPlace, DEFAULT_DIMENSIONS } from './_shared/placement';

export function createShapeTools(workspaceId: string): Record<string, CanvasTool> {
  return {
    canvas_create_shape: {
      name: 'canvas_create_shape',
      defer_loading: true,
      description:
        'Create a primitive geometric shape on the canvas. Supported kinds: ' +
        '"rect", "rounded-rect", "ellipse", "triangle", "diamond", "hexagon", "star". ' +
        'Shapes are visual-only annotations — they render as SVG primitives with configurable ' +
        'fill, stroke, and stroke width, and an optional centered text label. ' +
        'Pass explicit width/height for precise sizing; otherwise defaults to 200×140. ' +
        'Colors accept hex strings (e.g. "#E8EEF7") or the literal string "transparent".',
      inputSchema: z.object({
        kind: z
          .enum(['rect', 'rounded-rect', 'ellipse', 'triangle', 'diamond', 'hexagon', 'star'])
          .optional()
          .describe('Shape primitive. Defaults to "rect".'),
        title: z.string().optional().describe('Node title (used in the layers panel). Defaults to "Shape".'),
        x: z.number().optional().describe('X position (canvas coords). Auto-placed if omitted.'),
        y: z.number().optional().describe('Y position (canvas coords). Auto-placed if omitted.'),
        width: z.number().optional().describe('Width in canvas-px. Default 200.'),
        height: z.number().optional().describe('Height in canvas-px. Default 140.'),
        fill: z.string().optional().describe('Fill color (hex or "transparent"). Default "#E8EEF7".'),
        stroke: z.string().optional().describe('Stroke color (hex or "transparent"). Default "#5B7CBF".'),
        strokeWidth: z.number().optional().describe('Stroke width in px. Default 2. Set 0 for no stroke.'),
        text: z.string().optional().describe('Optional label rendered centered inside the shape.'),
        textColor: z.string().optional().describe('Text color (hex). Defaults to the stroke color when present.'),
        fontSize: z.number().optional().describe('Text font size in px. Default 16.'),
      }),
      execute: async (input) => {
        const canvas = await loadCanvas(workspaceId);
        if (!canvas) return 'Error: workspace not found';

        const kind = (input.kind as string | undefined) ?? 'rect';
        const title = (input.title as string) ?? DEFAULT_DIMENSIONS.shape.title;
        const width = (input.width as number | undefined) ?? DEFAULT_DIMENSIONS.shape.width;
        const height = (input.height as number | undefined) ?? DEFAULT_DIMENSIONS.shape.height;

        const nodeId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const pos = (input.x != null && input.y != null)
          ? { x: input.x as number, y: input.y as number }
          : autoPlace(canvas.nodes);

        const newNode: CanvasNode = {
          id: nodeId,
          type: 'shape',
          title,
          x: pos.x,
          y: pos.y,
          width,
          height,
          data: {
            kind,
            fill: (input.fill as string | undefined) ?? '#E8EEF7',
            stroke: (input.stroke as string | undefined) ?? '#5B7CBF',
            strokeWidth: (input.strokeWidth as number | undefined) ?? 2,
            text: (input.text as string | undefined) ?? '',
            textColor: input.textColor as string | undefined,
            fontSize: input.fontSize as number | undefined,
          },
          updatedAt: Date.now(),
        };

        const fresh = (await loadCanvas(workspaceId)) ?? canvas;
        fresh.nodes.push(newNode);
        await saveCanvas(workspaceId, fresh);
        broadcastUpdate(workspaceId, [nodeId]);

        return JSON.stringify({ ok: true, nodeId, kind, title });
      },
    },
  };
}
