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
    '',
  ];
  return lines.join('\n');
}
