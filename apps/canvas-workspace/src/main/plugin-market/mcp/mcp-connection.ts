import type { NormalizedPluginPackage } from '../../../shared/plugin-market';
import { getPluginMarketAgentPort } from '../agent-port';

function remoteServers(plugin: NormalizedPluginPackage) {
  const pluginId = plugin.name.replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'plugin';
  return (plugin.mcp?.servers ?? [])
    .filter((server) => server.type !== 'stdio')
    .map((server) => ({
      ...server,
      runtimeName: `${pluginId}.${server.name}`,
    }));
}

export async function packageMcpAuthState(
  plugin: NormalizedPluginPackage,
): Promise<'connectable' | 'connected' | undefined> {
  const servers = remoteServers(plugin);
  if (servers.length === 0) return undefined;
  const statuses = getPluginMarketAgentPort().getMcpStatuses();
  return servers.every((server) => statuses[server.runtimeName]?.ok)
    ? 'connected'
    : 'connectable';
}

// The engine retains the AI SDK transport error message in MCPServerStatus.
// Match its status field or the Canvas provider's explicit interactive-auth request.
// A response body mentioning 401 is not a challenge.
function isAuthorizationChallenge(error: string): boolean {
  return /^MCP (?:HTTP|SSE) Transport Error: POSTing to endpoint \(HTTP 401\):/.test(error)
    || /^MCP SSE Transport Error: 401(?: |$)/.test(error)
    || error === 'MCP OAuth connection required. Use Settings -> MCP -> Connect.';
}

export async function connectPackageMcp(plugin: NormalizedPluginPackage): Promise<void> {
  const servers = remoteServers(plugin);
  if (servers.length === 0) throw new Error('Plugin has no remote MCP server to connect');
  const port = getPluginMarketAgentPort();
  // Reload activates the global scope and probes through the configured transport,
  // including headers, user overrides and any existing OAuth credentials.
  await port.reloadMcp();
  const statuses = port.getMcpStatuses();
  const next = servers.find((server) => !statuses[server.runtimeName]?.ok);
  if (!next) return;
  const status = statuses[next.runtimeName];
  if (!status || status.ok) throw new Error(`MCP connection status unavailable: ${next.runtimeName}`);
  if (!isAuthorizationChallenge(status.error)) throw new Error(status.error);
  await port.connectMcpOAuth(next.runtimeName, next.url);
}
