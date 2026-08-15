import { getRegisteredCanvasToolFactories } from '../../../plugins/main';
import { getActiveDockWorkspaceId } from '../../dock/tab-store';
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
import { createMemoryTools } from './memory';
import { createScheduledTools } from './scheduled';
import { createRoleTools } from './roles';

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

const explicitWorkspaceIdSchema = z
  .string()
  .min(1)
  .describe('Target workspace ID. Required in global chat; obtain it from canvas_list_workspaces or an explicit workspace mention.');

const activeDockWorkspaceIdSchema = z
  .string()
  .min(1)
  .optional()
  .describe('Target workspace ID. Omit to use the workspace currently hosting the visible Dock.');

/** Allow Global chat to operate the visible Dock without turning its
 * conversation into a workspace conversation. An explicit workspace remains
 * available when the user intentionally targets another isolated Dock. */
function requireWorkspaceIdOrActiveDock(tool: CanvasTool): CanvasTool | undefined {
  if (!(tool.inputSchema instanceof z.ZodObject)) return undefined;

  return {
    ...tool,
    description:
      `${tool.description}\n\nGlobal chat note: workspaceId is optional for the visible Dock; ` +
      'if omitted, the current Dock workspace is used. Pass it explicitly to target another workspace.',
    inputSchema: tool.inputSchema.extend({ workspaceId: activeDockWorkspaceIdSchema }),
    execute: async (input, ctx) => {
      const explicitWorkspaceId = typeof input?.workspaceId === 'string' ? input.workspaceId.trim() : '';
      const workspaceId = explicitWorkspaceId || getActiveDockWorkspaceId();
      if (!workspaceId) {
        return 'Error: no active Dock workspace is available. Select a Workspace or pass workspaceId explicitly.';
      }
      return tool.execute({ ...input, workspaceId }, ctx);
    },
  };
}

/**
 * Turn a workspace-bound tool into a Global-chat tool without binding it to
 * the empty-string workspace. The target tool set is resolved lazily from the
 * selected workspace (or, for interactive browser tools, the visible Dock
 * route), so the same public tool can safely operate on an isolated target.
 */
function requireExplicitWorkspaceId(
  tool: CanvasTool,
  targetToolSets: Map<string, Record<string, CanvasTool>>,
  options: { allowActiveDock?: boolean } = {},
): CanvasTool | undefined {
  if (!(tool.inputSchema instanceof z.ZodObject)) return undefined;
  const allowActiveDock = options.allowActiveDock === true;

  return {
    ...tool,
    description:
      `${tool.description}\n\nGlobal chat note: ${allowActiveDock
        ? 'workspaceId is optional for the visible Dock; if omitted, the current Dock workspace is used. '
        : 'pass an explicit workspaceId for the canvas this operation should affect. '
      }` + (allowActiveDock
        ? 'Pass workspaceId explicitly to target another workspace.'
        : 'Do not guess a workspaceId; resolve it with canvas_list_workspaces or use the user-provided workspace mention.'),
    inputSchema: tool.inputSchema.extend({
      workspaceId: allowActiveDock ? activeDockWorkspaceIdSchema : explicitWorkspaceIdSchema,
    }),
    execute: async (input, ctx) => {
      const explicitWorkspaceId = typeof input?.workspaceId === 'string' ? input.workspaceId.trim() : '';
      const workspaceId = explicitWorkspaceId || (allowActiveDock ? getActiveDockWorkspaceId() : '');
      if (!workspaceId) {
        return allowActiveDock
          ? 'Error: no active Dock workspace is available. Select a Workspace or pass workspaceId explicitly.'
          : 'Error: workspaceId is required in global chat. Ask the user which workspace to affect, or use canvas_list_workspaces to identify it.';
      }

      let targetTools = targetToolSets.get(workspaceId);
      if (!targetTools) {
        targetTools = createCanvasTools(workspaceId);
        targetToolSets.set(workspaceId, targetTools);
      }
      const targetTool = targetTools[tool.name];
      if (!targetTool) {
        return `Error: ${tool.name} is unavailable for workspace ${workspaceId}.`;
      }
      return targetTool.execute({ ...input, workspaceId }, ctx);
    },
  };
}

export interface GlobalCanvasToolsOptions {
  /**
   * Interactive Global chat may opt into workspace-bound operations, but
   * canvas/node/resource operations still require an explicit workspaceId.
   * Browser tab/page operations may additionally use the visible Dock route.
   * Keep this false for scheduled/headless runs, which must retain the narrow
   * explicit-target surface.
   */
  allowWorkspaceTargetedTools?: boolean;
}

/**
 * Tool set for global chat (no current canvas workspace). Read/search canvas
 * tools are wrapped to require an explicit workspaceId, while interactive
 * browser tools can route to the visible Dock Workspace. The cross-workspace
 * knowledge index is eager. Interactive Global chat can additionally opt into
 * the full workspace tool surface through target wrappers. The default stays
 * without target-workspace mutations so scheduled/headless callers cannot
 * inherit those mutations.
 */
export function createGlobalCanvasTools(
  options: GlobalCanvasToolsOptions = {},
): Record<string, CanvasTool> {
  const nodeTools = createNodeTools('');
  const searchTools = createSearchTools('');
  const edgeTools = createEdgeTools('');
  const workspaceNodeTools = createWorkspaceNodeTools('');
  const layoutTools = createLayoutTools('');
  const tabTools = createTabTools('');
  const webpageTools = createWebpageTools('');

  const targetToolSets = new Map<string, Record<string, CanvasTool>>();
  const tools: Record<string, CanvasTool> = {
    canvas_ask_user: nodeTools.canvas_ask_user,
    canvas_read_context: requireWorkspaceId(nodeTools.canvas_read_context),
    canvas_read_node: requireWorkspaceId(nodeTools.canvas_read_node),
    canvas_read_dom_selection: options.allowWorkspaceTargetedTools
      ? requireWorkspaceIdOrActiveDock(webpageTools.canvas_read_dom_selection)!
      : requireWorkspaceId(webpageTools.canvas_read_dom_selection),
    canvas_list_tabs: options.allowWorkspaceTargetedTools
      ? requireWorkspaceIdOrActiveDock(tabTools.canvas_list_tabs)!
      : requireWorkspaceId(tabTools.canvas_list_tabs),
    canvas_activate_tab: options.allowWorkspaceTargetedTools
      ? requireWorkspaceIdOrActiveDock(tabTools.canvas_activate_tab)!
      : requireWorkspaceId(tabTools.canvas_activate_tab),
    canvas_read_tab: options.allowWorkspaceTargetedTools
      ? requireWorkspaceIdOrActiveDock(tabTools.canvas_read_tab)!
      : requireWorkspaceId(tabTools.canvas_read_tab),
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
    // Long-term memory. In global chat ('' workspaceId) the factory scopes
    // every operation to GLOBAL memory, so this write is safe to expose here.
    ...createMemoryTools(''),
    // Scheduled tasks are app-level (no ambient workspace), so they stay
    // unwrapped here exactly as in workspace chat.
    ...createScheduledTools(),
    // Group-chat roles live in one app-level library — same posture.
    ...createRoleTools(),
  };

  if (options.allowWorkspaceTargetedTools) {
    const directGlobalToolNames = new Set(Object.keys(tools));
    const workspaceToolPrototypes = createCanvasTools('');

    // Keep app-level/cross-workspace tools from being shadowed. Every other
    // tool is made targetable and receives a workspaceId in its Global schema;
    // browser reads/controls may resolve it from the visible Dock route,
    // including plugin-contributed page tools.
    for (const [name, tool] of Object.entries(workspaceToolPrototypes)) {
      if (directGlobalToolNames.has(name)) continue;
      const targeted = name === 'canvas_read_webpage' || name.startsWith('page_')
        ? requireExplicitWorkspaceId(tool, targetToolSets, { allowActiveDock: true })
        : requireExplicitWorkspaceId(tool, targetToolSets);
      if (targeted) tools[name] = targeted;
    }
  }

  return tools;
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
    ...createMemoryTools(workspaceId),
    ...createScheduledTools(),
    ...createRoleTools(),
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
