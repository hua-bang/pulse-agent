import { promises as fs } from 'fs';
import { join } from 'path';
import { STORE_DIR } from '../canvas/storage';
import type {
  AgentTeamRecord,
  HumanGateRecord,
  MailboxMessage,
  TeamAgentRecord,
  TeamArtifactRecord,
  TeamEvent,
  TeamId,
  TeamRuntimeStore,
  TeamTaskRecord,
} from 'pulse-coder-agent-teams/runtime';
import type { CanvasAgentTeamMetadata } from './types';

interface PersistedAgentTeamRuntimeState {
  teams: AgentTeamRecord[];
  agents: TeamAgentRecord[];
  tasks: TeamTaskRecord[];
  artifacts: TeamArtifactRecord[];
  humanGates: HumanGateRecord[];
  events: TeamEvent[];
  messages: MailboxMessage[];
  metadata: Record<TeamId, CanvasAgentTeamMetadata>;
}

const emptyState = (): PersistedAgentTeamRuntimeState => ({
  teams: [],
  agents: [],
  tasks: [],
  artifacts: [],
  humanGates: [],
  events: [],
  messages: [],
  metadata: {},
});

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export class CanvasAgentTeamStore implements TeamRuntimeStore {
  private loaded = false;
  private state: PersistedAgentTeamRuntimeState = emptyState();

  constructor(private readonly workspaceId: string) {}

  async saveTeamMetadata(teamId: TeamId, metadata: CanvasAgentTeamMetadata): Promise<void> {
    await this.ensureLoaded();
    this.state.metadata[teamId] = clone(metadata);
    await this.persist();
  }

  async getTeamMetadata(teamId: TeamId): Promise<CanvasAgentTeamMetadata | undefined> {
    await this.ensureLoaded();
    const metadata = this.state.metadata[teamId];
    return metadata ? clone(metadata) : undefined;
  }

  async listTeamMetadata(): Promise<Array<{ teamId: TeamId; metadata: CanvasAgentTeamMetadata }>> {
    await this.ensureLoaded();
    return Object.entries(this.state.metadata).map(([teamId, metadata]) => ({
      teamId,
      metadata: clone(metadata),
    }));
  }

  async saveTeam(team: AgentTeamRecord): Promise<void> {
    await this.upsert('teams', team);
  }

  async getTeam(teamId: TeamId): Promise<AgentTeamRecord | undefined> {
    await this.ensureLoaded();
    const team = this.state.teams.find((item) => item.id === teamId);
    return team ? clone(team) : undefined;
  }

  async deleteTeam(teamId: TeamId): Promise<void> {
    await this.ensureLoaded();
    this.state.teams = this.state.teams.filter((team) => team.id !== teamId);
    this.state.agents = this.state.agents.filter((agent) => agent.teamId !== teamId);
    this.state.tasks = this.state.tasks.filter((task) => task.teamId !== teamId);
    this.state.artifacts = this.state.artifacts.filter((artifact) => artifact.teamId !== teamId);
    this.state.humanGates = this.state.humanGates.filter((gate) => gate.teamId !== teamId);
    this.state.events = this.state.events.filter((event) => event.teamId !== teamId);
    this.state.messages = this.state.messages.filter((message) => message.teamId !== teamId);
    delete this.state.metadata[teamId];
    await this.persist();
  }

  async saveAgent(agent: TeamAgentRecord): Promise<void> {
    await this.upsert('agents', agent);
  }

  async getAgent(agentId: string): Promise<TeamAgentRecord | undefined> {
    await this.ensureLoaded();
    const agent = this.state.agents.find((item) => item.id === agentId);
    return agent ? clone(agent) : undefined;
  }

  async listAgents(teamId: TeamId): Promise<TeamAgentRecord[]> {
    await this.ensureLoaded();
    return this.state.agents
      .filter((agent) => agent.teamId === teamId)
      .map(clone);
  }

  async saveTask(task: TeamTaskRecord): Promise<void> {
    await this.upsert('tasks', task);
  }

  async getTask(taskId: string): Promise<TeamTaskRecord | undefined> {
    await this.ensureLoaded();
    const task = this.state.tasks.find((item) => item.id === taskId);
    return task ? clone(task) : undefined;
  }

  async listTasks(teamId: TeamId): Promise<TeamTaskRecord[]> {
    await this.ensureLoaded();
    return this.state.tasks
      .filter((task) => task.teamId === teamId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(clone);
  }

  async saveArtifact(artifact: TeamArtifactRecord): Promise<void> {
    await this.upsert('artifacts', artifact);
  }

  async listArtifacts(teamId: TeamId): Promise<TeamArtifactRecord[]> {
    await this.ensureLoaded();
    return this.state.artifacts
      .filter((artifact) => artifact.teamId === teamId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(clone);
  }

  async saveHumanGate(gate: HumanGateRecord): Promise<void> {
    await this.upsert('humanGates', gate);
  }

  async getHumanGate(gateId: string): Promise<HumanGateRecord | undefined> {
    await this.ensureLoaded();
    const gate = this.state.humanGates.find((item) => item.id === gateId);
    return gate ? clone(gate) : undefined;
  }

  async listHumanGates(teamId: TeamId): Promise<HumanGateRecord[]> {
    await this.ensureLoaded();
    return this.state.humanGates
      .filter((gate) => gate.teamId === teamId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(clone);
  }

  async appendEvent(event: TeamEvent): Promise<void> {
    await this.ensureLoaded();
    this.state.events.push(clone(event));
    await this.persist();
  }

  async listEvents(teamId: TeamId): Promise<TeamEvent[]> {
    await this.ensureLoaded();
    return this.state.events
      .filter((event) => event.teamId === teamId)
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(clone);
  }

  async appendMessage(message: MailboxMessage): Promise<void> {
    await this.ensureLoaded();
    this.state.messages.push(clone(message));
    await this.persist();
  }

  async listMessages(teamId: TeamId): Promise<MailboxMessage[]> {
    await this.ensureLoaded();
    return this.state.messages
      .filter((message) => message.teamId === teamId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(clone);
  }

  private async upsert<K extends 'teams' | 'agents' | 'tasks' | 'artifacts' | 'humanGates'>(
    key: K,
    record: PersistedAgentTeamRuntimeState[K][number],
  ): Promise<void> {
    await this.ensureLoaded();
    const collection = this.state[key] as Array<{ id: string }>;
    const idx = collection.findIndex((item) => item.id === record.id);
    if (idx >= 0) {
      collection[idx] = clone(record) as { id: string };
    } else {
      collection.push(clone(record) as { id: string });
    }
    await this.persist();
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(this.statePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistedAgentTeamRuntimeState>;
      this.state = {
        ...emptyState(),
        ...parsed,
        metadata: parsed.metadata ?? {},
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        console.warn(`[agent-teams] failed to load state for ${this.workspaceId}:`, err);
      }
      this.state = emptyState();
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const tmp = `${this.statePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.state, null, 2), 'utf-8');
    await fs.rename(tmp, this.statePath);
  }

  private get dir(): string {
    return join(STORE_DIR, this.workspaceId, 'agent-teams');
  }

  private get statePath(): string {
    return join(this.dir, 'state.json');
  }
}
