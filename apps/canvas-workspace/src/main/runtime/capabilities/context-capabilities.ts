import { z } from 'zod';

import { buildDetailedContext, buildWorkspaceSummary } from '../../agent/context-builder';
import { CapabilityError, type AnyCapabilityDefinition } from './types';

const contextReadInputSchema = z.object({
  /**
   * summary (default): the lightweight workspace map the Canvas Agent gets
   * in its system prompt — node inventory, titles, positions, edges.
   * detailed: the full canvas_read_context payload with per-node content;
   * expensive, ask for it only when the summary is not enough.
   */
  scope: z.enum(['summary', 'detailed']).optional(),
});

export interface ContextCapabilityDependencies {
  readSummary: (workspaceId: string) => Promise<unknown>;
  readDetailed: (workspaceId: string) => Promise<unknown>;
}

const requireWorkspace = async (
  workspaceId: string,
  load: (workspaceId: string) => Promise<unknown>,
): Promise<unknown> => {
  const context = await load(workspaceId);
  if (!context) {
    throw new CapabilityError('workspace_not_found', `workspace not found: ${workspaceId}`);
  }
  return context;
};

const defaultDependencies: ContextCapabilityDependencies = {
  readSummary: (workspaceId) => requireWorkspace(workspaceId, buildWorkspaceSummary),
  readDetailed: (workspaceId) => requireWorkspace(workspaceId, buildDetailedContext),
};

export function createContextCapabilities(
  dependencies: ContextCapabilityDependencies = defaultDependencies,
): AnyCapabilityDefinition[] {
  return [
    {
      name: 'canvas.context.read',
      description:
        'Read the workspace context: the same canvas map the Canvas Agent works from. scope=summary (default) returns the node/edge inventory; scope=detailed adds per-node content and is expensive.',
      risk: 'read',
      inputSchema: contextReadInputSchema,
      execute: ({ scope }, context) => (
        scope === 'detailed'
          ? dependencies.readDetailed(context.workspaceId)
          : dependencies.readSummary(context.workspaceId)
      ),
    },
  ];
}
