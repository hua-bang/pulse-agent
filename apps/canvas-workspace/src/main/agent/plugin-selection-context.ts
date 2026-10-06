import { formatMcpAppChatContext } from './mcp-app-chat-context';
import type { AgentRequestContext } from '../../shared/agent-chat';
import type { AgentContextPluginRef } from '../../shared/agent-chat';

const promptLabel = (value: string): string => (
  value.replace(/[\r\n]+/g, ' ').replace(/`/g, "'").trim().slice(0, 200)
);

export function formatSelectedPluginsBlock(
  plugins: AgentContextPluginRef[] = [],
): string {
  if (plugins.length === 0) return '';
  const lines = [
    '',
    '## Explicit Plugin Preference',
    'The user selected the following installed plugin capability bundles for this turn:',
    ...plugins.map(plugin => `- **${promptLabel(plugin.name)}** (plugin id: \`${promptLabel(plugin.id)}\`)`),
    '',
    'Treat this as a routing preference and scope hint, not as an instruction to call a tool unnecessarily. When the request benefits from one of these plugins, prefer its skills or MCP tools over unrelated alternatives. If the selected capability is unavailable or disconnected, explain that honestly and use another source only when it preserves the user\'s intent.',
    'If the user also references canvas nodes, their content remains the primary source. Use the plugin only for specific missing information or a requested action; a plugin preference does not require reopening an App that is already on the canvas.',
    '',
  ];
  return lines.join('\n');
}

/** User-selected capabilities and the visible App are both turn-owned context. */
export function formatSelectedAppAndPluginsBlock(context?: AgentRequestContext): string {
  return formatSelectedPluginsBlock(context?.plugins) + formatMcpAppChatContext(context?.mcpAppContext);
}
