import { getRegisteredCanvasToolFactories } from '../../../plugins/main';
import { z } from 'zod';
import type { CanvasTool } from './types';
import { createNodeTools } from './nodes';
import { createSearchTools } from './search';
import { createGroupTools } from './groups';
import { createWorkspaceNodeTools } from './workspace-nodes';
import { createKnowledgeTools } from './knowledge';
import { createTaggingTools } from './tagging';
import { createAgentTools } from './agents';
import { createTerminalTools } from './terminals';
import { createShapeTools } from './shapes';
import { createEdgeTools } from './edges-tools';
import { createImageTools } from './images';
import { createVisualTools } from './visual';
import { createArtifactTools } from './artifacts';
import { createWebpageTools } from './webpage';
import { createSkillTools } from './skills';

export type { CanvasTool, CanvasToolExecutionContext } from './types';

// ─── Tool definitions ──────────────────────────────────────────────

const requireWorkspaceId = (tool: CanvasTool): CanvasTool => {
  const schema = tool.inputSchema instanceof z.ZodObject
    ? tool.inputSchema.extend({
        workspaceId: z.string().min(1).describe('Target workspace ID. Required in global chat because there is no current workspace.'),
      })
    : tool.inputSchema;

  return {
    ...tool,
    description:
      `${tool.description}\n\nGlobal chat note: workspaceId is required; there is no current/default workspace in global chat.`,
    inputSchema: schema,
    execute: async (input, ctx) => {
      if (!input?.workspaceId || typeof input.workspaceId !== 'string') {
        return 'Error: workspaceId is required in global chat. Ask the user which workspace to inspect, or use a workspace mention to identify it.';
      }
      return tool.execute(input, ctx);
    },
  };
};

/**
 * Tool set for global chat (no current workspace). Read/search canvas tools
 * are wrapped to require an explicit workspaceId; the cross-workspace knowledge
 * index is eager. The one sanctioned write is `canvas_tag_node` — it edits
 * knowledge-layer tags only (never canvas layout), so a tagging skill can apply
 * tags across workspaces without leaving global chat.
 */
export function createGlobalCanvasTools(): Record<string, CanvasTool> {
  const nodeTools = createNodeTools('');
  const searchTools = createSearchTools('');
  const edgeTools = createEdgeTools('');
  const workspaceNodeTools = createWorkspaceNodeTools('');

  const base: Record<string, CanvasTool> = {
    canvas_ask_user: nodeTools.canvas_ask_user,
    canvas_read_context: requireWorkspaceId(nodeTools.canvas_read_context),
    canvas_read_node: requireWorkspaceId(nodeTools.canvas_read_node),
    canvas_search_nodes: requireWorkspaceId(searchTools.canvas_search_nodes),
    canvas_list_edges: requireWorkspaceId(edgeTools.canvas_list_edges),
    workspace_node_list: requireWorkspaceId(workspaceNodeTools.workspace_node_list),
    workspace_node_get: requireWorkspaceId(workspaceNodeTools.workspace_node_get),
    // Cross-workspace knowledge index. These inherently span every workspace
    // (workspaceId is optional), so they are NOT wrapped with requireWorkspaceId
    // and stay eager — global chat must see them up front to read local
    // workspaces / tags / nodes instead of reaching for an external MCP server.
    ...createKnowledgeTools(),
    // The only allowed write in global chat: knowledge-layer tagging.
    ...createTaggingTools(),
  };

  // Plugin-contributed tools run for global chat too — an empty workspaceId
  // signals "global"; each plugin's factory handles that case (e.g. memory
  // maps '' to the global scope). Factories that throw are skipped so one bad
  // plugin can't break global chat. (Workspace chat merges these in
  // createCanvasTools below.)
  for (const [pluginId, factory] of getRegisteredCanvasToolFactories()) {
    try {
      Object.assign(base, factory('') as Record<string, CanvasTool>);
    } catch (err) {
      console.error(
        `[canvas-tools] plugin ${pluginId} global tool factory threw; skipping its tools`,
        err,
      );
    }
  }

  return base;
}

export function createCanvasTools(workspaceId: string): Record<string, CanvasTool> {
  const base: Record<string, CanvasTool> = {
    ...createNodeTools(workspaceId),
    ...createSearchTools(workspaceId),
    ...createGroupTools(workspaceId),
    ...createWorkspaceNodeTools(workspaceId),
    ...createKnowledgeTools(),
    ...createTaggingTools(),
    ...createAgentTools(workspaceId),
    ...createTerminalTools(workspaceId),
    ...createShapeTools(workspaceId),
    ...createEdgeTools(workspaceId),
    ...createImageTools(workspaceId),
    ...createVisualTools(workspaceId),
    ...createArtifactTools(workspaceId),
    ...createWebpageTools(workspaceId),
    ...createSkillTools(workspaceId),
  };

  // Plugin-contributed tools (see `plugins/main/registry.ts`). A plugin's
  // factory is in the registry iff its `enabledWhen` returned true at
  // bootstrap, so flag-gating is already enforced — we just merge what
  // each factory produces for this workspace. Last writer wins on name
  // collisions; that matters if a future plugin shadows a built-in tool
  // intentionally (none do today).
  for (const [pluginId, factory] of getRegisteredCanvasToolFactories()) {
    try {
      const contributed = factory(workspaceId) as Record<string, CanvasTool>;
      Object.assign(base, contributed);
    } catch (err) {
      console.error(
        `[canvas-tools] plugin ${pluginId} tool factory threw; skipping its tools`,
        err,
      );
    }
  }

  return base;
}
