import { z } from 'zod';

import { readNodeDetail } from '../../agent/context-builder';
import {
  searchCanvasNodes,
  updateCanvasNode,
} from '../../canvas/node-operations';
import { CapabilityError, type AnyCapabilityDefinition } from './types';

const searchableNodeTypeSchema = z.enum([
  'file',
  'terminal',
  'frame',
  'group',
  'agent',
  'text',
  'iframe',
  'image',
  'shape',
  'mindmap',
]);

const nodeReadInputSchema = z.object({
  nodeId: z.string().min(1),
});

const nodeSearchInputSchema = z.object({
  query: z.string().optional(),
  type: z.union([searchableNodeTypeSchema, z.array(searchableNodeTypeSchema)]).optional(),
  tag: z.union([z.string(), z.array(z.string())]).optional(),
  limit: z.number().int().positive().max(200).optional(),
});

const nodeUpdateInputSchema = z.object({
  nodeId: z.string().min(1),
  title: z.string().optional(),
  content: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export type NodeSearchInput = z.infer<typeof nodeSearchInputSchema>;
export type NodeUpdateInput = z.infer<typeof nodeUpdateInputSchema>;

export interface NodeCapabilityDependencies {
  readNode: (workspaceId: string, nodeId: string) => Promise<unknown>;
  searchNodes: (workspaceId: string, input: NodeSearchInput) => Promise<unknown>;
  updateNode: (workspaceId: string, input: NodeUpdateInput) => Promise<unknown>;
}

const defaultDependencies: NodeCapabilityDependencies = {
  readNode: async (workspaceId, nodeId) => {
    const detail = await readNodeDetail(workspaceId, nodeId);
    if (!detail) {
      throw new CapabilityError(
        'node_not_found',
        `node not found: ${nodeId} (workspace: ${workspaceId})`,
      );
    }
    return detail;
  },
  searchNodes: async (workspaceId, input) => {
    const result = await searchCanvasNodes(workspaceId, input);
    if (!result) {
      throw new CapabilityError('workspace_not_found', `workspace not found: ${workspaceId}`);
    }
    return result;
  },
  updateNode: async (workspaceId, input) => {
    const result = await updateCanvasNode(workspaceId, input);
    switch (result) {
      case 'updated':
        return { nodeId: input.nodeId };
      case 'workspace_not_found':
        throw new CapabilityError('workspace_not_found', 'workspace not found');
      case 'node_not_found':
        throw new CapabilityError('node_not_found', `node not found: ${input.nodeId}`);
      case 'deleted_concurrently':
        throw new CapabilityError(
          'node_deleted_concurrently',
          `node ${input.nodeId} was deleted concurrently; update aborted`,
        );
    }
  },
};

export function createNodeCapabilities(
  dependencies: NodeCapabilityDependencies = defaultDependencies,
): AnyCapabilityDefinition[] {
  return [
    {
      name: 'canvas.nodes.read',
      description: 'Read the full live detail of one Canvas node.',
      risk: 'read',
      inputSchema: nodeReadInputSchema,
      execute: ({ nodeId }, context) => dependencies.readNode(context.workspaceId, nodeId),
    },
    {
      name: 'canvas.nodes.search',
      description: 'Search Canvas nodes by text, type, or knowledge tag.',
      risk: 'read',
      inputSchema: nodeSearchInputSchema,
      execute: (input, context) => dependencies.searchNodes(context.workspaceId, input),
    },
    {
      name: 'canvas.nodes.update',
      description:
        'Update one Canvas node. Pulse CLI may change title/content; internal Canvas Agent callers may also patch data fields.',
      risk: 'operate',
      inputSchema: nodeUpdateInputSchema,
      execute: (input, context) => {
        if (context.actor.kind === 'pulse-cli' && input.data) {
          throw new CapabilityError(
            'unsafe_input',
            'Pulse CLI may update node title/content but cannot patch internal data fields.',
          );
        }
        return dependencies.updateNode(context.workspaceId, input);
      },
    },
  ];
}
