import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { withStorageSession } from '../core/sqlite-store';
import { NODE_VIEW_RESOURCE, readNodeViewResource } from './resource';
import { NODE_VIEW_RESOURCE_URI, CANVAS_TOOLS, callCanvasTool, toolError, type CanvasToolContext } from './tools';

/**
 * Version of the contract between the agent plugin launcher and this server
 * (`pulse-canvas mcp --plugin-api <n>`). Bump when a plugin release starts to
 * depend on tools or behavior an older CLI does not provide.
 */
export const MCP_PLUGIN_API_VERSION = 1;

export interface CanvasMcpServerOptions extends CanvasToolContext {
  version: string;
  /** Plugin API the launcher expects; newer than ours → upgrade-only mode. */
  pluginApi?: number;
}

const INSTRUCTIONS = [
  'Pulse Canvas tools read and change the user\'s local canvas workspaces.',
  'Read with canvas_context, canvas_search, and canvas_read_nodes before changing anything,',
  'then batch edits into one canvas_apply call.',
  'Call canvas_open with a nodeId to show that node to the user (for example a mindmap you just built).',
].join(' ');

const UPGRADE_TOOL: Tool = {
  name: 'canvas_status',
  title: 'Pulse Canvas status',
  description: 'Explains why the Pulse Canvas tools are unavailable.',
  inputSchema: { type: 'object', properties: {} },
  annotations: { readOnlyHint: true },
};

function upgradeResult(pluginApi: number): CallToolResult {
  return toolError(
    'plugin_api_unsupported',
    `This Pulse Canvas plugin needs plugin API ${pluginApi}, but the installed Pulse Canvas CLI ` +
    `supports ${MCP_PLUGIN_API_VERSION}. Update the Pulse Canvas app, then restart the agent.`,
  );
}

export function createCanvasMcpServer(options: CanvasMcpServerOptions): Server {
  const ctx: CanvasToolContext = { storeDir: options.storeDir, env: options.env };
  const unsupportedApi = options.pluginApi !== undefined && options.pluginApi > MCP_PLUGIN_API_VERSION
    ? options.pluginApi
    : undefined;

  const server = new Server(
    { name: 'pulse-canvas', title: 'Pulse Canvas', version: options.version },
    {
      capabilities: { tools: {}, resources: {} },
      instructions: INSTRUCTIONS,
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: unsupportedApi !== undefined ? [UPGRADE_TOOL] : CANVAS_TOOLS.map(tool => tool.definition),
  }));

  server.setRequestHandler(CallToolRequestSchema, async request => {
    if (unsupportedApi !== undefined) return upgradeResult(unsupportedApi);
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    // One storage session per call: the app may activate SQLite between calls.
    return withStorageSession(() => callCanvasTool(request.params.name, args, ctx));
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: unsupportedApi !== undefined ? [] : [NODE_VIEW_RESOURCE],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async request => {
    if (request.params.uri !== NODE_VIEW_RESOURCE_URI || unsupportedApi !== undefined) {
      throw new Error(`Unknown resource: ${request.params.uri}`);
    }
    return readNodeViewResource();
  });

  return server;
}

export async function runCanvasMcpStdio(options: CanvasMcpServerOptions): Promise<void> {
  const server = createCanvasMcpServer(options);
  const transport = new StdioServerTransport();
  const closed = new Promise<void>(resolve => {
    server.onclose = () => resolve();
  });
  await server.connect(transport);
  await closed;
}
