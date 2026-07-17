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
import { createScreenshotTools } from './screenshot';
import { createVisualTools } from './visual';
import { createArtifactTools } from './artifacts';
import { createWebpageTools } from './webpage';
import { createTabTools } from './tab';
import { createSkillTools } from './skills';
import { createSessionTools } from './sessions';
import { createPluginNodeTools } from './plugin-nodes';
import { createHtmlPatchTools } from './html-patch';
import { createLayoutTools } from './layout-tools';

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
 * index is eager. Global chat remains read-only for node data.
 */
export function createGlobalCanvasTools(): Record<string, CanvasTool> {
  const nodeTools = createNodeTools('');
  const searchTools = createSearchTools('');
  const edgeTools = createEdgeTools('');
  const workspaceNodeTools = createWorkspaceNodeTools('');
  const layoutTools = createLayoutTools('');
  const tabTools = createTabTools('');

  return {
    canvas_ask_user: nodeTools.canvas_ask_user,
    canvas_read_context: requireWorkspaceId(nodeTools.canvas_read_context),
    canvas_read_node: requireWorkspaceId(nodeTools.canvas_read_node),
    canvas_list_tabs: requireWorkspaceId(tabTools.canvas_list_tabs),
    canvas_read_tab: requireWorkspaceId(tabTools.canvas_read_tab),
    // Dock-tab open + browsing-history search work without an ambient
    // workspace (the dock and history are app-level), so they stay unwrapped.
    canvas_open_tab: tabTools.canvas_open_tab,
    canvas_search_history: tabTools.canvas_search_history,
    canvas_read_layout: requireWorkspaceId(layoutTools.canvas_read_layout),
    canvas_search_nodes: requireWorkspaceId(searchTools.canvas_search_nodes),
    canvas_list_edges: requireWorkspaceId(edgeTools.canvas_list_edges),
    workspace_node_list: requireWorkspaceId(workspaceNodeTools.workspace_node_list),
    workspace_node_get: requireWorkspaceId(workspaceNodeTools.workspace_node_get),
    // Cross-workspace knowledge index. These inherently span every workspace
    // (workspaceId is optional), so they are NOT wrapped with requireWorkspaceId
    // and stay eager — global chat must see them up front to read local
    // workspaces / tags / nodes instead of reaching for an external MCP server.
    ...createKnowledgeTools(),
    // Chat-session history (检索/总结). Inherently cross-workspace (workspaceId
    // is optional), so not wrapped with requireWorkspaceId.
    ...createSessionTools(),
    // Screen / window capture is workspace-independent (it grabs the OS screen,
    // another app window, or this canvas window), so it works in global chat too.
    ...createScreenshotTools(''),
  };
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
    ...createScreenshotTools(workspaceId),
    ...createVisualTools(workspaceId),
    ...createArtifactTools(workspaceId),
    ...createWebpageTools(workspaceId),
    ...createTabTools(workspaceId),
    ...createSkillTools(workspaceId),
    ...createSessionTools(workspaceId),
    ...createHtmlPatchTools(workspaceId),
    ...createPluginNodeTools(workspaceId),
    ...createLayoutTools(workspaceId),
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
