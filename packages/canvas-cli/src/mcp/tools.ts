import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { applyPlan, type ApplyOperation } from '../core/apply';
import { generateContext } from '../core/context';
import { readNode, searchNodes } from '../core/nodes';
import { getWorkspaceDir, loadCanvas } from '../core/store';
import { resolveWorkspaceId, WorkspaceResolutionError } from '../core/workspace-resolution';
import { storageErrorCode } from '../core/sqlite-store';
import {
  buildSnapshot,
  listWorkspaceSummaries,
  readCanvasVersion,
  workspaceName,
} from './snapshot';

/**
 * Tool surface of `pulse-canvas mcp`.
 *
 * Model-visible tools stay few and prompt-sized; the view's bulk reads use
 * app-only tools (`_meta.ui.visibility: ["app"]`) so full snapshots never
 * enter the model context. Every read and write is confined to the
 * workspace directory: canvases may be untrusted and tool output reaches
 * the model.
 */

export const CANVAS_APP_RESOURCE_URI = 'ui://pulse-canvas/workspace.html';

/** Upper bound for one `canvas_apply` call from a model or the view. */
export const MAX_APPLY_OPERATIONS = 200;
const MAX_READ_NODES = 20;

export interface CanvasToolContext {
  storeDir?: string;
  env?: NodeJS.ProcessEnv;
}

type ToolArgs = Record<string, unknown>;

export interface CanvasTool {
  definition: Tool;
  handler: (args: ToolArgs, ctx: CanvasToolContext) => Promise<CallToolResult>;
}

export function toolError(code: string, message: string): CallToolResult {
  const payload = { ok: false, code, error: message };
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function toolOk(data: Record<string, unknown>, text?: string): CallToolResult {
  return {
    content: [{ type: 'text', text: text ?? JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function optionalString(args: ToolArgs, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

async function resolveTarget(args: ToolArgs, ctx: CanvasToolContext): Promise<string> {
  const resolution = await resolveWorkspaceId({
    explicitId: optionalString(args, 'workspaceId'),
    storeDir: ctx.storeDir,
    env: ctx.env,
  });
  return resolution.workspaceId;
}

const workspaceIdProperty = {
  type: 'string',
  description: 'Workspace id. Defaults to the workspace active in Pulse Canvas.',
};

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const appOnly = { ui: { visibility: ['app'] } };

const openCanvas: CanvasTool = {
  definition: {
    name: 'canvas_open',
    title: 'Open Pulse Canvas',
    description:
      'Open a Pulse Canvas workspace in an interactive view where the user can see and edit nodes and edges. ' +
      'Accepts {} to open the active workspace.',
    inputSchema: { type: 'object', properties: { workspaceId: workspaceIdProperty } },
    annotations: { title: 'Open Pulse Canvas', ...readOnly },
    _meta: {
      ui: { resourceUri: CANVAS_APP_RESOURCE_URI },
      'ui/resourceUri': CANVAS_APP_RESOURCE_URI,
      'openai/outputTemplate': CANVAS_APP_RESOURCE_URI,
      'openai/ui': {
        entrypoints: [{ type: 'global' }],
        preferredDisplayMode: 'fullscreen',
        availableDisplayModes: ['fullscreen', 'inline'],
      },
    },
  },
  async handler(args, ctx) {
    const workspaces = await listWorkspaceSummaries(ctx.storeDir);
    let workspaceId: string | null = null;
    try {
      workspaceId = await resolveTarget(args, ctx);
    } catch (err) {
      // `{}` must always open: with no resolvable workspace the view shows a picker.
      if (optionalString(args, 'workspaceId')) throw err;
    }
    if (!workspaceId) {
      return toolOk(
        { workspaceId: null, workspaces },
        `Opened Pulse Canvas. No workspace is active; ${workspaces.length} workspace(s) are available to pick.`,
      );
    }
    const canvas = await loadCanvas(workspaceId, ctx.storeDir);
    const name = await workspaceName(workspaceId, ctx.storeDir);
    const nodeCount = canvas?.nodes.length ?? 0;
    const edgeCount = canvas?.edges?.length ?? 0;
    return toolOk(
      { workspaceId, workspaceName: name, nodeCount, edgeCount, workspaces },
      `Opened Pulse Canvas workspace "${name}" (${workspaceId}): ${nodeCount} nodes, ${edgeCount} edges. ` +
      'Use canvas_context to read its content and canvas_apply to change it.',
    );
  },
};

const listWorkspaces: CanvasTool = {
  definition: {
    name: 'canvas_list_workspaces',
    title: 'List canvas workspaces',
    description: 'List Pulse Canvas workspaces with their ids, names, and which one is active.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'List canvas workspaces', ...readOnly },
  },
  async handler(_args, ctx) {
    return toolOk({ workspaces: await listWorkspaceSummaries(ctx.storeDir) });
  },
};

const readContext: CanvasTool = {
  definition: {
    name: 'canvas_context',
    title: 'Read canvas context',
    description:
      'Structured summary of every node (id, type, title, short description) and edge in a workspace. ' +
      'Use canvas_read_nodes for full bodies.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: workspaceIdProperty,
        types: { type: 'array', items: { type: 'string' }, description: 'Only include these node types.' },
      },
    },
    annotations: { title: 'Read canvas context', ...readOnly },
  },
  async handler(args, ctx) {
    const workspaceId = await resolveTarget(args, ctx);
    const types = Array.isArray(args.types)
      ? args.types.filter((value): value is string => typeof value === 'string')
      : undefined;
    const context = await generateContext(workspaceId, ctx.storeDir, { confineToWorkspace: true, types });
    if (!context) return toolError('workspace_not_found', `Workspace not found: ${workspaceId}`);
    return toolOk(context as unknown as Record<string, unknown>);
  },
};

const searchCanvas: CanvasTool = {
  definition: {
    name: 'canvas_search',
    title: 'Search canvas nodes',
    description: 'Case-insensitive search over node titles and inline content. Returns ids with snippets.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: workspaceIdProperty,
        query: { type: 'string' },
        type: { type: 'string', description: 'Only match this node type.' },
        limit: { type: 'number', description: 'Maximum hits (default 20).' },
      },
      required: ['query'],
    },
    annotations: { title: 'Search canvas nodes', ...readOnly },
  },
  async handler(args, ctx) {
    const query = optionalString(args, 'query');
    if (!query) return toolError('invalid_argument', 'query is required.');
    const workspaceId = await resolveTarget(args, ctx);
    const canvas = await loadCanvas(workspaceId, ctx.storeDir);
    if (!canvas) return toolError('workspace_not_found', `Workspace not found: ${workspaceId}`);
    const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(args.limit, 100) : 20;
    const hits = searchNodes(canvas.nodes, query, { type: optionalString(args, 'type'), limit });
    return toolOk({ workspaceId, hits });
  },
};

const readNodes: CanvasTool = {
  definition: {
    name: 'canvas_read_nodes',
    title: 'Read canvas nodes',
    description: 'Read full node bodies and metadata by id (up to 20 ids per call).',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: workspaceIdProperty,
        nodeIds: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: MAX_READ_NODES },
      },
      required: ['nodeIds'],
    },
    annotations: { title: 'Read canvas nodes', ...readOnly },
  },
  async handler(args, ctx) {
    const ids = Array.isArray(args.nodeIds)
      ? args.nodeIds.filter((value): value is string => typeof value === 'string')
      : [];
    if (ids.length === 0 || ids.length > MAX_READ_NODES) {
      return toolError('invalid_argument', `nodeIds must hold 1-${MAX_READ_NODES} ids.`);
    }
    const workspaceId = await resolveTarget(args, ctx);
    const canvas = await loadCanvas(workspaceId, ctx.storeDir);
    if (!canvas) return toolError('workspace_not_found', `Workspace not found: ${workspaceId}`);
    const confineToDir = getWorkspaceDir(workspaceId, ctx.storeDir);
    const nodes = [];
    for (const id of ids) {
      const node = canvas.nodes.find(candidate => candidate.id === id);
      nodes.push(node
        ? { id, title: node.title, ...(await readNode(node, { confineToDir })) }
        : { id, error: `Node not found: ${id}`, code: 'node_not_found' });
    }
    return toolOk({ workspaceId, nodes });
  },
};

const applyChanges: CanvasTool = {
  definition: {
    name: 'canvas_apply',
    title: 'Change canvas',
    description:
      'Atomically apply node/edge operations. Actions: create {type:file|frame|group|mindmap, title?, x?, y?, ' +
      'width?, height?, content?, data?}; update {id, title?, x?, y?, width?, height?, content?} (file/text: ' +
      'markdown; frame/group: JSON {label?,color?}); delete {id}; createEdge {from, to, label?, kind?}; ' +
      'deleteEdge {id}. Pass baseRevision to reject stale plans.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: workspaceIdProperty,
        baseRevision: { type: 'number' },
        operations: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_APPLY_OPERATIONS,
          items: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['create', 'update', 'delete', 'createEdge', 'deleteEdge'] },
            },
            required: ['action'],
          },
        },
      },
      required: ['operations'],
    },
    annotations: { title: 'Change canvas', readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
  async handler(args, ctx) {
    const operations = args.operations;
    if (!Array.isArray(operations) || operations.length === 0 || operations.length > MAX_APPLY_OPERATIONS) {
      return toolError('invalid_argument', `operations must hold 1-${MAX_APPLY_OPERATIONS} entries.`);
    }
    if (operations.some(op => !op || typeof op !== 'object' || Array.isArray(op))) {
      return toolError('invalid_argument', 'Every operation must be an object with an action.');
    }
    const workspaceId = await resolveTarget(args, ctx);
    const result = await applyPlan(workspaceId, {
      baseRevision: typeof args.baseRevision === 'number' ? args.baseRevision : undefined,
      operations: operations as ApplyOperation[],
    }, { storeDir: ctx.storeDir, confineToWorkspace: true });
    if (!result.ok) return toolError(result.code ?? 'error', result.error);
    const version = await readCanvasVersion(workspaceId, ctx.storeDir);
    return toolOk({ ...result.data, version: version?.version ?? null });
  },
};

const uiSnapshot: CanvasTool = {
  definition: {
    name: 'canvas_ui_snapshot',
    title: 'Canvas view snapshot',
    description: 'Render snapshot for the Pulse Canvas view.',
    inputSchema: { type: 'object', properties: { workspaceId: workspaceIdProperty } },
    annotations: { title: 'Canvas view snapshot', ...readOnly },
    _meta: appOnly,
  },
  async handler(args, ctx) {
    const workspaceId = await resolveTarget(args, ctx);
    const snapshot = await buildSnapshot(workspaceId, ctx.storeDir);
    if (!snapshot) return toolError('workspace_not_found', `Workspace not found: ${workspaceId}`);
    return toolOk(
      { snapshot, workspaces: await listWorkspaceSummaries(ctx.storeDir) },
      `Snapshot of ${workspaceId}: ${snapshot.nodes.length} nodes.`,
    );
  },
};

const uiVersion: CanvasTool = {
  definition: {
    name: 'canvas_ui_version',
    title: 'Canvas view version',
    description: 'Change token for the Pulse Canvas view.',
    inputSchema: { type: 'object', properties: { workspaceId: workspaceIdProperty }, required: ['workspaceId'] },
    annotations: { title: 'Canvas view version', ...readOnly },
    _meta: appOnly,
  },
  async handler(args, ctx) {
    const workspaceId = await resolveTarget(args, ctx);
    const version = await readCanvasVersion(workspaceId, ctx.storeDir);
    if (!version) return toolError('workspace_not_found', `Workspace not found: ${workspaceId}`);
    return toolOk({ workspaceId, ...version });
  },
};

export const CANVAS_TOOLS: CanvasTool[] = [
  openCanvas,
  listWorkspaces,
  readContext,
  searchCanvas,
  readNodes,
  applyChanges,
  uiSnapshot,
  uiVersion,
];

export async function callCanvasTool(
  name: string,
  args: ToolArgs,
  ctx: CanvasToolContext,
): Promise<CallToolResult> {
  const tool = CANVAS_TOOLS.find(candidate => candidate.definition.name === name);
  if (!tool) return toolError('unsupported', `Unknown tool: ${name}`);
  try {
    return await tool.handler(args, ctx);
  } catch (err) {
    const code = err instanceof WorkspaceResolutionError ? err.code : storageErrorCode(err);
    return toolError(code, (err as Error).message ?? String(err));
  }
}
