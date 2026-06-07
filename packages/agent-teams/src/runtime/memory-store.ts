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
} from './types.js';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export class InMemoryTeamRuntimeStore implements TeamRuntimeStore {
  private teams = new Map<string, AgentTeamRecord>();
  private agents = new Map<string, TeamAgentRecord>();
  private tasks = new Map<string, TeamTaskRecord>();
  private artifacts = new Map<string, TeamArtifactRecord>();
  private humanGates = new Map<string, HumanGateRecord>();
  private events: TeamEvent[] = [];
  private messages: MailboxMessage[] = [];

  async saveTeam(team: AgentTeamRecord): Promise<void> {
    this.teams.set(team.id, clone(team));
  }

  async getTeam(teamId: TeamId): Promise<AgentTeamRecord | undefined> {
    const team = this.teams.get(teamId);
    return team ? clone(team) : undefined;
  }

  async deleteTeam(teamId: TeamId): Promise<void> {
    this.teams.delete(teamId);
    for (const [agentId, agent] of this.agents) {
      if (agent.teamId === teamId) this.agents.delete(agentId);
    }
    for (const [taskId, task] of this.tasks) {
      if (task.teamId === teamId) this.tasks.delete(taskId);
    }
    for (const [artifactId, artifact] of this.artifacts) {
      if (artifact.teamId === teamId) this.artifacts.delete(artifactId);
    }
    for (const [gateId, gate] of this.humanGates) {
      if (gate.teamId === teamId) this.humanGates.delete(gateId);
    }
    this.events = this.events.filter(event => event.teamId !== teamId);
    this.messages = this.messages.filter(message => message.teamId !== teamId);
  }

  async saveAgent(agent: TeamAgentRecord): Promise<void> {
    this.agents.set(agent.id, clone(agent));
  }

  async getAgent(agentId: string): Promise<TeamAgentRecord | undefined> {
    const agent = this.agents.get(agentId);
    return agent ? clone(agent) : undefined;
  }

  async listAgents(teamId: TeamId): Promise<TeamAgentRecord[]> {
    return Array.from(this.agents.values())
      .filter(agent => agent.teamId === teamId)
      .map(clone);
  }

  async saveTask(task: TeamTaskRecord): Promise<void> {
    this.tasks.set(task.id, clone(task));
  }

  async getTask(taskId: string): Promise<TeamTaskRecord | undefined> {
    const task = this.tasks.get(taskId);
    return task ? clone(task) : undefined;
  }

  async listTasks(teamId: TeamId): Promise<TeamTaskRecord[]> {
    return Array.from(this.tasks.values())
      .filter(task => task.teamId === teamId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(clone);
  }

  async saveArtifact(artifact: TeamArtifactRecord): Promise<void> {
    this.artifacts.set(artifact.id, clone(artifact));
  }

  async listArtifacts(teamId: TeamId): Promise<TeamArtifactRecord[]> {
    return Array.from(this.artifacts.values())
      .filter(artifact => artifact.teamId === teamId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(clone);
  }

  async saveHumanGate(gate: HumanGateRecord): Promise<void> {
    this.humanGates.set(gate.id, clone(gate));
  }

  async getHumanGate(gateId: string): Promise<HumanGateRecord | undefined> {
    const gate = this.humanGates.get(gateId);
    return gate ? clone(gate) : undefined;
  }

  async listHumanGates(teamId: TeamId): Promise<HumanGateRecord[]> {
    return Array.from(this.humanGates.values())
      .filter(gate => gate.teamId === teamId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(clone);
  }

  async appendEvent(event: TeamEvent): Promise<void> {
    this.events.push(clone(event));
  }

  async listEvents(teamId: TeamId): Promise<TeamEvent[]> {
    return this.events
      .filter(event => event.teamId === teamId)
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(clone);
  }

  async appendMessage(message: MailboxMessage): Promise<void> {
    this.messages.push(clone(message));
  }

  async listMessages(teamId: TeamId): Promise<MailboxMessage[]> {
    return this.messages
      .filter(message => message.teamId === teamId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(clone);
  }
}
