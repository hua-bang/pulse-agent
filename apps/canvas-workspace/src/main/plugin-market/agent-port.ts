export interface PluginMarketAgentPort {
  reloadMcp: () => Promise<void>;
  getMcpOAuthStatus: (serverName: string) => Promise<{
    connected: boolean;
    hasClientInformation: boolean;
  }>;
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
