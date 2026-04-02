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

export interface TeamMemberConfig {
  teammateId: string;
  name: string;
  role: string;
  runtime: AgentRuntime;
  isLead: boolean;
  model?: string;
  spawnPrompt?: string;
}

export interface RunTeamConfig {
  teamId: string;
  teamName: string;
  goal: string;
  members: TeamMemberConfig[];
  cwd?: string;
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
  private teamAgents = new Map<string, Set<string>>(); // teamId → Set<teammateId>
  private teamStateDirs = new Map<string, string>(); // teamId → stateDir
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

    // Send spawn prompt as initial input after a brief delay
    // (wait for CLI to be ready to accept input)
    if (config.spawnPrompt) {
      const prompt = config.spawnPrompt;
      setTimeout(() => {
        const a = this.agents.get(teammateId);
        if (a && a.status === 'running') {
          a.ptyProcess.write(prompt + '\n');
        }
      }, 2000);
    }

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
   * Run a team: create shared state dir, initialize tasks from goal, spawn all members.
   */
  async runTeam(config: RunTeamConfig): Promise<{ teamStateDir: string }> {
    const { teamId, teamName, goal, members, cwd } = config;

    // Create team state directory
    const stateDir = join(homedir(), '.pulse-coder', 'teams', teamId);
    mkdirSync(join(stateDir, 'tasks'), { recursive: true });
    mkdirSync(join(stateDir, 'mailbox'), { recursive: true });
    mkdirSync(join(stateDir, 'mcp-configs'), { recursive: true });

    // Write team config
    const teamConfig = {
      name: teamName,
      teamId,
      goal,
      createdAt: Date.now(),
      members: members.map(m => ({
        id: m.teammateId,
        name: m.name,
        role: m.role,
        isLead: m.isLead,
        runtime: m.runtime,
      })),
    };
    writeFileSync(join(stateDir, 'config.json'), JSON.stringify(teamConfig, null, 2), 'utf-8');

    // Initialize empty task list if none exists
    const tasksPath = join(stateDir, 'tasks', 'tasks.json');
    if (!existsSync(tasksPath)) {
      writeFileSync(tasksPath, JSON.stringify([], null, 2), 'utf-8');
    }

    this.teamStateDirs.set(teamId, stateDir);
    this.teamAgents.set(teamId, new Set());

    // Spawn all members
    const lead = members.find(m => m.isLead) || members[0];
    const spawnOrder = [lead, ...members.filter(m => m !== lead)];

    for (const member of spawnOrder) {
      const memberIds = this.teamAgents.get(teamId)!;
      memberIds.add(member.teammateId);

      // Build spawn prompt: lead gets the goal + team info, others get role
      let prompt = member.spawnPrompt || '';
      if (member.isLead) {
        const teamInfo = members
          .filter(m => !m.isLead)
          .map(m => `- ${m.name} (${m.teammateId}): ${m.role}`)
          .join('\n');
        prompt = [
          `You are the team lead "${member.name}" for team "${teamName}".`,
          `Team Goal: ${goal}`,
          teamInfo ? `\nTeam Members:\n${teamInfo}` : '',
          '',
          'Use team_create_task to create tasks for your team, team_list_tasks to monitor progress, and team_send_message to communicate with teammates.',
          prompt ? `\nAdditional instructions: ${prompt}` : '',
        ].filter(Boolean).join('\n');
      } else {
        prompt = [
          `You are teammate "${member.name}" in team "${teamName}".`,
          `Your role: ${member.role}`,
          '',
          'Use team_claim_task to pick up work, team_complete_task when done, and team_send_message / team_read_messages to communicate.',
          prompt ? `\nAdditional instructions: ${prompt}` : '',
        ].filter(Boolean).join('\n');
      }

      try {
        await this.spawnAgent({
          teammateId: member.teammateId,
          runtime: member.runtime,
          cwd,
          model: member.model,
          spawnPrompt: prompt,
          teamStateDir: stateDir,
        });
      } catch (err) {
        // Emit error but continue spawning others
        this.emitToRenderer('agent-team:event', {
          type: 'agent:spawn_failed',
          timestamp: Date.now(),
          data: { teammateId: member.teammateId, teamId, error: String(err) },
        });
      }
    }

    this.emitToRenderer('agent-team:event', {
      type: 'team:started',
      timestamp: Date.now(),
      data: { teamId, teamName, memberCount: members.length, stateDir },
    });

    return { teamStateDir: stateDir };
  }

  /**
   * Stop all agents in a team.
   */
  stopTeam(teamId: string): void {
    const memberIds = this.teamAgents.get(teamId);
    if (!memberIds) return;

    for (const id of memberIds) {
      this.stopAgent(id);
    }

    this.teamAgents.delete(teamId);

    this.emitToRenderer('agent-team:event', {
      type: 'team:stopped',
      timestamp: Date.now(),
      data: { teamId },
    });
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
