import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

export interface MCPServerConfig {
  command: string;
  args: string[];
}

export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

/**
 * Generate MCP config JSON for a teammate to connect to the team MCP server.
 */
export function generateMCPConfig(
  stateDir: string,
  teammateId: string,
  serverScriptPath?: string,
): MCPConfig {
  const scriptPath = serverScriptPath || getMCPServerScriptPath();

  return {
    mcpServers: {
      'agent-team': {
        command: 'node',
        args: [scriptPath, '--state-dir', stateDir, '--teammate-id', teammateId],
      },
    },
  };
}

/**
 * Write MCP config to a file. Creates parent directories if needed.
 */
export function writeMCPConfigFile(filePath: string, config: MCPConfig): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Generate a temporary MCP config file path for a teammate.
 */
export function getMCPConfigPath(stateDir: string, teammateId: string): string {
  return join(stateDir, 'mcp-configs', `${teammateId}.json`);
}

/**
 * Convenience: generate and write MCP config for a teammate, return the file path.
 */
export function setupMCPConfig(
  stateDir: string,
  teammateId: string,
  serverScriptPath?: string,
): string {
  const config = generateMCPConfig(stateDir, teammateId, serverScriptPath);
  const configPath = getMCPConfigPath(stateDir, teammateId);
  writeMCPConfigFile(configPath, config);
  return configPath;
}

/**
 * Get CLI args to pass MCP config to a specific runtime.
 */
export function getMCPArgs(runtime: 'pulse-agent' | 'claude-code' | 'codex', mcpConfigPath: string): string[] {
  switch (runtime) {
    case 'claude-code':
      return ['--mcp-config', mcpConfigPath];
    case 'codex':
      return ['--mcp-config', mcpConfigPath];
    case 'pulse-agent':
      return ['--mcp-config', mcpConfigPath];
  }
}

/**
 * Resolve the path to the MCP server script (compiled JS).
 */
function getMCPServerScriptPath(): string {
  // In production, use the compiled dist output
  // The MCP server is bundled as part of the agent-teams package
  return join(dirname(new URL(import.meta.url).pathname), 'mcp-server.js');
}
