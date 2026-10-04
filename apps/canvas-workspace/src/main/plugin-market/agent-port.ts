import type { MCPServerStatus } from 'pulse-coder-engine/built-in';

export interface PluginMarketAgentPort {
  reloadMcp: () => Promise<void>;
  getMcpStatuses: () => Record<string, MCPServerStatus>;
  connectMcpOAuth: (serverName: string, serverUrl: string) => Promise<void>;
}

let agentPort: PluginMarketAgentPort | null = null;

export function setPluginMarketAgentPort(port: PluginMarketAgentPort): void {
  agentPort = port;
}

export function getPluginMarketAgentPort(): PluginMarketAgentPort {
  if (!agentPort) throw new Error('Plugin Market Agent integration is unavailable.');
  return agentPort;
}
