import { z } from 'zod';
import { readWorkspaceMeta } from '../workspace-meta';
import type { CanvasNode, CanvasTool } from './types';
import { loadCanvas, saveCanvas } from './_shared/canvas-io';
import { broadcastUpdate } from './_shared/broadcast';
import {
  DEFAULT_DIMENSIONS,
  placementIntentSchema,
  resolvePlacement,
  type PlacementIntent,
} from './_shared/placement';

export function createTerminalTools(workspaceId: string): Record<string, CanvasTool> {
  return {
    canvas_create_terminal_node: {
      name: 'canvas_create_terminal_node',
      defer_loading: true,
      description:
        'Create and spawn an interactive terminal node on the canvas. ' +
        'The shell starts automatically. Use `command` to execute a command after the shell is ready ' +
        '(e.g. "npm run dev", "docker compose up").',
      inputSchema: z.object({
        title: z.string().optional().describe('Node title (e.g. "Dev Server", "Build"). Defaults to "Terminal".'),
        cwd: z.string().optional().describe('Working directory for the shell. Defaults to workspace root.'),
        command: z.string().optional().describe('Shell command to execute automatically after spawn (e.g. "npm run dev").'),
        x: z.number().optional().describe('X position (auto-placed if omitted).'),
        y: z.number().optional().describe('Y position (auto-placed if omitted).'),
        placement: placementIntentSchema.optional().describe(
          'Semantic insertion strategy. Use near_node for terminals related to a source node, inside_frame to place into a frame, or omit to append without moving existing nodes.',
        ),
      }),
      execute: async (input) => {
        const canvas = await loadCanvas(workspaceId);
        if (!canvas) return 'Error: workspace not found';

        const title = (input.title as string) ?? DEFAULT_DIMENSIONS.terminal.title;
        const explicitCwd = (input.cwd as string | undefined) ?? '';
        const cwd = explicitCwd || (await readWorkspaceMeta(workspaceId)).rootFolder || '';
        const initialCommand = (input.command as string) ?? '';

        const nodeId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const def = DEFAULT_DIMENSIONS.terminal;
        let pos: { x: number; y: number };
        try {
          pos = resolvePlacement(
            canvas.nodes,
            { width: def.width, height: def.height },
            { x: input.x as number | undefined, y: input.y as number | undefined },
            input.placement as PlacementIntent | undefined,
          );
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }

        const newNode: CanvasNode = {
          id: nodeId,
          type: 'terminal',
          title,
          x: pos.x,
          y: pos.y,
          width: def.width,
          height: def.height,
          data: { sessionId: '', cwd, initialCommand },
          updatedAt: Date.now(),
        };

        const fresh = (await loadCanvas(workspaceId)) ?? canvas;
        fresh.nodes.push(newNode);
        await saveCanvas(workspaceId, fresh);
        broadcastUpdate(workspaceId, [nodeId]);

        return JSON.stringify({ ok: true, nodeId, title });
      },
    },
  };
}
