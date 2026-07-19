import { z } from 'zod';

import { getCanvasCapabilityRuntime } from '../../runtime/capabilities';
import type { CanvasTool } from './types';

export function createSearchTools(workspaceId: string): Record<string, CanvasTool> {
  return {
    canvas_search_nodes: {
      name: 'canvas_search_nodes',
      description:
        'Search canvas nodes by query, type, or workspace-node tag. ' +
        'Returns a compact list (id, type, title, snippet) so you can avoid pulling the whole canvas summary when you only need a few matches. ' +
        'Use this before `canvas_read_node` to narrow down which nodes to read in detail.',
      inputSchema: z.object({
        query: z.string().optional().describe(
          'Case-insensitive substring matched against node title, label, content, url, and filePath.',
        ),
        type: z.union([
          z.enum(['file', 'terminal', 'frame', 'group', 'agent', 'text', 'iframe', 'image', 'shape', 'mindmap']),
          z.array(z.enum(['file', 'terminal', 'frame', 'group', 'agent', 'text', 'iframe', 'image', 'shape', 'mindmap'])),
        ]).optional().describe('Restrict to one or more node types.'),
        tag: z.union([z.string(), z.array(z.string())]).optional().describe(
          'Filter by workspace-node tag(s), given as tag NAME or id. A node matches when its workspace-node record has ALL provided tags in `properties.tags` ' +
          '(stored as tag ids/slugs; names are resolved automatically, case-insensitively). ' +
          'Tags live in the knowledge layer (`workspace-node-store`), not on the canvas node itself.',
        ),
        limit: z.number().int().positive().max(200).optional().describe('Max results to return. Default 30.'),
        workspaceId: z.string().optional().describe('Target workspace ID. Defaults to the current workspace.'),
      }),
      execute: async (input, context) => {
        const { workspaceId: inputWorkspaceId, ...capabilityInput } = input;
        const targetWorkspaceId = (inputWorkspaceId as string) || workspaceId;
        const result = await getCanvasCapabilityRuntime().call(
          'canvas.nodes.search',
          capabilityInput,
          {
            workspaceId: targetWorkspaceId,
            actor: { kind: 'canvas-agent' },
            abortSignal: context?.abortSignal,
          },
        );
        if (!result.ok) return `Error: ${result.error.message}`;
        return JSON.stringify({ ok: true, ...(result.value as object) });
      },
    },
  };
}
