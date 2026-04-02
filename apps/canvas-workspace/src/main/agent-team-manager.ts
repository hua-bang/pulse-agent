/**
 * AgentTeamManager
 *
 * Manages agent lifecycle in the Electron main process.
 * Spawns agent CLI sessions via node-pty, sets up MCP config,
 * and forwards events to the renderer.
 */

import { BrowserWindow } from 'electron';
import * as pty from 'node-pty';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir, platform } from 'os';
import { randomUUID } from 'crypto';

// ─── Types ─────────────────────────────────────────────────────

export type AgentRuntime = 'pulse-agent' | 'claude-code' | 'codex';
export type AgentStatus = 'idle' | 'running' | 'waiting' | 'stopping' | 'stopped' | 'completed' | 'failed';

export interface AgentSpawnConfig {
  teammateId: string;
  runtime: AgentRuntime;
  cwd?: string;
  model?: string;
  spawnPrompt?: string;
  teamStateDir?: string;
}

export interface ManagedAgent {
  teammateId: string;
  runtime: AgentRuntime;
  sessionId: string;
  ptyProcess: pty.IPty;
  status: AgentStatus;
  mcpConfigPath?: string;
}

export interface AgentTeamEvent {
  type: string;
  timestamp: number;
  data: Record<string, unknown>;
}

// ─── Runtime commands ──────────────────────────────────────────

function getAgentCommand(runtime: AgentRuntime): { command: string; args: string[] } {
  switch (runtime) {
    case 'claude-code':
      return { command: 'claude', args: [] };
    case 'codex':
      return { command: 'codex', args: [] };
    case 'pulse-agent':
      return { command: 'pulse-agent', args: [] };
  }
}

function getMCPArgs(runtime: AgentRuntime, mcpConfigPath: string): string[] {
  // All supported runtimes accept --mcp-config
  return ['--mcp-config', mcpConfigPath];
}

// ─── MCP Config ────────────────────────────────────────────────

function generateMCPConfig(stateDir: string, teammateId: string): object {
  // Resolve path to the MCP server script
  // In the Electron app, we look for it in the agent-teams package dist
  let serverScript: string;
  try {
    serverScript = require.resolve('pulse-coder-agent-teams/mcp-server');
  } catch {
    // Fallback: look in node_modules
    serverScript = join(dirname(require.resolve('pulse-coder-agent-teams')), 'mcp-server.js');
  }

  return {
    mcpServers: {
      'agent-team': {
        command: 'node',
        args: [serverScript, '--state-dir', stateDir, '--teammate-id', teammateId],
      },
    },
  };
}

function writeMCPConfigFile(stateDir: string, teammateId: string): string {
  const configDir = join(stateDir, 'mcp-configs');
  mkdirSync(configDir, { recursive: true });
  const configPath = join(configDir, `${teammateId}.json`);
  const config = generateMCPConfig(stateDir, teammateId);
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  return configPath;
}

// ─── Manager ───────────────────────────────────────────────────

export class AgentTeamManager {
  private agents = new Map<string, ManagedAgent>();
  private eventHandlers: Array<(event: AgentTeamEvent) => void> = [];

  /**
   * Spawn an agent CLI session.
   */
  async spawnAgent(config: AgentSpawnConfig): Promise<{ sessionId: string; pid: number }> {
    const { teammateId, runtime, cwd, teamStateDir } = config;

    if (this.agents.has(teammateId)) {
      throw new Error(`Agent ${teammateId} is already running`);
    }

    const sessionId = `agent-${teammateId}-${Date.now()}`;

    // Set up MCP config if we have a team state dir
    let mcpConfigPath: string | undefined;
    if (teamStateDir) {
      mcpConfigPath = writeMCPConfigFile(teamStateDir, teammateId);
    }

    // Determine command and args
    const { command, args } = getAgentCommand(runtime);
    const fullArgs = [...args];
    if (mcpConfigPath) {
      fullArgs.push(...getMCPArgs(runtime, mcpConfigPath));
    }

    // Spawn PTY
    const spawnCwd = cwd || homedir();
    const proc = pty.spawn(command, fullArgs, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: spawnCwd,
      env: {
        ...(process.env as Record<string, string>),
      },
    });

    const agent: ManagedAgent = {
      teammateId,
      runtime,
      sessionId,
      ptyProcess: proc,
      status: 'running',
      mcpConfigPath,
    };

    this.agents.set(teammateId, agent);

    // Forward PTY data to renderer
    proc.onData((data: string) => {
      this.emitToRenderer(`agent-team:output:${teammateId}`, data);
    });

    proc.onExit(({ exitCode }) => {
      const a = this.agents.get(teammateId);
      if (a) {
        a.status = exitCode === 0 ? 'completed' : 'failed';
      }
      this.emit({
        type: 'agent:exited',
        timestamp: Date.now(),
        data: { teammateId, exitCode },
      });
      this.emitToRenderer('agent-team:event', {
        type: 'agent:exited',
        timestamp: Date.now(),
        data: { teammateId, exitCode, status: exitCode === 0 ? 'completed' : 'failed' },
      });
    });

    this.emit({
      type: 'agent:spawned',
      timestamp: Date.now(),
      data: { teammateId, runtime, sessionId, pid: proc.pid },
    });

    this.emitToRenderer('agent-team:event', {
      type: 'agent:spawned',
      timestamp: Date.now(),
      data: { teammateId, runtime, sessionId, status: 'running' },
    });

    return { sessionId, pid: proc.pid };
  }

  /**
   * Send input to an agent's PTY.
   */
  sendInput(teammateId: string, data: string): void {
    const agent = this.agents.get(teammateId);
    if (!agent) return;
    agent.ptyProcess.write(data);
  }

  /**
   * Resize an agent's PTY.
   */
  resizeAgent(teammateId: string, cols: number, rows: number): void {
    const agent = this.agents.get(teammateId);
    if (!agent) return;
    try {
      agent.ptyProcess.resize(cols, rows);
    } catch {
      // ignore resize on dead pty
    }
  }

  /**
   * Stop a specific agent.
   */
  stopAgent(teammateId: string): void {
    const agent = this.agents.get(teammateId);
    if (!agent) return;

    agent.status = 'stopped';
    try {
      agent.ptyProcess.kill();
    } catch {
      // ignore
    }
    this.agents.delete(teammateId);

    this.emitToRenderer('agent-team:event', {
      type: 'agent:stopped',
      timestamp: Date.now(),
      data: { teammateId, status: 'stopped' },
    });
  }

  /**
   * Stop all agents.
   */
  stopAll(): void {
    for (const [id] of this.agents) {
      this.stopAgent(id);
    }
  }

  /**
   * Get agent status.
   */
  getAgent(teammateId: string): ManagedAgent | undefined {
    return this.agents.get(teammateId);
  }

  /**
   * List all managed agents.
   */
  listAgents(): Array<{ teammateId: string; runtime: AgentRuntime; status: AgentStatus; sessionId: string }> {
    return Array.from(this.agents.values()).map(a => ({
      teammateId: a.teammateId,
      runtime: a.runtime,
      status: a.status,
      sessionId: a.sessionId,
    }));
  }

  /**
   * Subscribe to events.
   */
  onEvent(handler: (event: AgentTeamEvent) => void): () => void {
    this.eventHandlers.push(handler);
    return () => {
      this.eventHandlers = this.eventHandlers.filter(h => h !== handler);
    };
  }

  /**
   * Cleanup on shutdown.
   */
  cleanup(): void {
    this.stopAll();
  }

  // ─── Internal ──────────────────────────────────────────────

  private emit(event: AgentTeamEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch {
        // ignore handler errors
      }
    }
  }

  private emitToRenderer(channel: string, data: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, data);
      }
    }
  }
}
