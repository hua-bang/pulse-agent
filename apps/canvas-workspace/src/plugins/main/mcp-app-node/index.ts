import type { MainCanvasPlugin, PluginNodeCapabilityRef } from '../../types';
import {
  MCP_APP_NODE_PLUGIN_ID,
  MCP_APP_NODE_TYPE,
  parseMcpAppNodeBinding,
} from '../../../shared/mcp-app-node';

/** Mirrors the engine's provider-safe `mcp_<server>_<tool>` registration. */
const toolPrefix = (serverName: string): string => (
  `mcp_${serverName}_`.replace(/[^a-zA-Z0-9_-]/g, '_')
);

function readMcpAppNode({ node }: PluginNodeCapabilityRef) {
  const payload = (node.data as { payload?: unknown }).payload;
  const binding = parseMcpAppNodeBinding(payload);
  if (!binding) {
    return { content: 'MCP App node with an invalid binding; it cannot be opened.' };
  }
  // The app's data lives on its MCP server, so the Agent reads and acts
  // through that server's tools rather than through this node.
  return {
    content: [
      `MCP App "${binding.title}" from MCP server "${binding.serverName}"`,
      `(opened via ${binding.kind} entrypoint tool "${binding.toolName}").`,
      `To read or change its data, call that server's MCP tools (named ${toolPrefix(binding.serverName)}*).`,
    ].join(' '),
    binding,
  };
}

export const McpAppNodeMainPlugin: MainCanvasPlugin = {
  id: MCP_APP_NODE_PLUGIN_ID,
  activate(ctx) {
    ctx.registerNodeCapabilities(MCP_APP_NODE_TYPE, { read: readMcpAppNode });
  },
};
