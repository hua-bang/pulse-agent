import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
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

// Every append rewrites the whole state file and every snapshot ships the
// full lists, so unbounded event/message history makes long-running teams
// progressively slower. History is capped per team; trimmed entries go to a
// JSONL archive so later reporting/metrics can still read the full record.
const MAX_TEAM_EVENTS = 400;
const MAX_TEAM_MESSAGES = 400;

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
  // Shared in-flight load so concurrent first-touch operations don't each reset
  // `this.state` to an empty object (which would drop the others' mutations).
  private loadPromise: Promise<void> | null = null;
  private state: PersistedAgentTeamRuntimeState = emptyState();
  // Serializes all disk writes for this store. Many runtime operations persist
  // the full state concurrently; without a queue their temp-file renames race
  // and one rename can fire after another already moved the temp file, throwing
  // `ENOENT ... rename state.json.tmp -> state.json`.
  private persistQueue: Promise<void> = Promise.resolve();

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
    await fs.rm(join(this.dir, 'archive', `${teamId}.events.jsonl`), { force: true }).catch(() => {});
    await fs.rm(join(this.dir, 'archive', `${teamId}.messages.jsonl`), { force: true }).catch(() => {});
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
    const teamEvents = this.state.events.filter((item) => item.teamId === event.teamId);
    if (teamEvents.length > MAX_TEAM_EVENTS) {
      const dropped = new Set(teamEvents.slice(0, teamEvents.length - MAX_TEAM_EVENTS));
      this.state.events = this.state.events.filter((item) => !dropped.has(item));
      await this.archiveDropped('events', event.teamId, [...dropped]);
    }
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
    const teamMessages = this.state.messages.filter((item) => item.teamId === message.teamId);
    if (teamMessages.length > MAX_TEAM_MESSAGES) {
      const dropped = new Set(teamMessages.slice(0, teamMessages.length - MAX_TEAM_MESSAGES));
      this.state.messages = this.state.messages.filter((item) => !dropped.has(item));
      await this.archiveDropped('messages', message.teamId, [...dropped]);
    }
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

  private ensureLoaded(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (!this.loadPromise) {
      this.loadPromise = this.loadStateFile().then(() => {
        this.loaded = true;
      });
    }
    return this.loadPromise;
  }

  private async loadStateFile(): Promise<void> {
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
  }

  private persist(): Promise<void> {
    // Chain every write onto the previous one so renames never overlap. Each
    // write flushes the latest in-memory state (a superset of earlier pending
    // mutations), so serializing is safe and the last write wins consistently.
    const run = this.persistQueue.then(() => this.writeStateFile());
    // Keep the chain alive even if one write rejects, so later persists run.
    this.persistQueue = run.catch(() => {});
    return run;
  }

  private async writeStateFile(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    // Unique per-write temp name so two writers never collide on one temp file.
    const tmp = `${this.statePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify(this.state, null, 2), 'utf-8');
      await fs.rename(tmp, this.statePath);
    } catch (err) {
      await fs.unlink(tmp).catch(() => {});
      throw err;
    }
  }

  private async archiveDropped(
    kind: 'events' | 'messages',
    teamId: TeamId,
    dropped: unknown[],
  ): Promise<void> {
    if (dropped.length === 0) return;
    try {
      const dir = join(this.dir, 'archive');
      await fs.mkdir(dir, { recursive: true });
      const lines = `${dropped.map((item) => JSON.stringify(item)).join('\n')}\n`;
      await fs.appendFile(join(dir, `${teamId}.${kind}.jsonl`), lines, 'utf-8');
    } catch {
      // Archival is best effort; trimming must never fail the append.
    }
  }

  /** Directory holding the handoff files written by a team's agents. */
  handoffDir(teamId: TeamId): string {
    return join(this.dir, 'handoffs', teamId);
  }

  /**
   * Absolute path of a task's handoff file. Lives in app storage rather than
   * the team cwd so it never pollutes the user's repository, and stays in a
   * shared location if per-agent workspace isolation is added later.
   */
  handoffPath(teamId: TeamId, taskId: string): string {
    return join(this.handoffDir(teamId), `${taskId}.md`);
  }

  private get dir(): string {
    return join(STORE_DIR, this.workspaceId, 'agent-teams');
  }

  private get statePath(): string {
    return join(this.dir, 'state.json');
  }
}
