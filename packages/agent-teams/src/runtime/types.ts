export type TeamId = string;
export type AgentId = string;
export type TaskId = string;
export type ArtifactId = string;
export type HumanGateId = string;
export type TeamEventId = string;

export type TeamStatus =
  | 'planning'
  | 'waiting_approval'
  | 'running'
  | 'reviewing'
  | 'paused'
  | 'round_checkpoint'
  | 'completed'
  | 'failed';

export type AgentRole = 'lead' | 'teammate';

export type AgentStatus =
  | 'idle'
  | 'running'
  | 'needs_input'
  | 'blocked'
  | 'done'
  | 'error'
  | 'stopped';

export type TaskStatus =
  | 'todo'
  | 'in_progress'
  | 'needs_input'
  | 'needs_review'
  | 'blocked'
  | 'done'
  | 'failed';

export type HumanGateStatus = 'open' | 'answered' | 'cancelled';

export type ArtifactKind =
  | 'diff'
  | 'test_log'
  | 'note'
  | 'screenshot'
  | 'file'
  | 'summary'
  | 'other';

export interface AgentTeamRecord<Meta extends Record<string, unknown> = Record<string, unknown>> {
  id: TeamId;
  name: string;
  goal: string;
  status: TeamStatus;
  leadAgentId?: AgentId;
  createdAt: number;
  updatedAt: number;
  metadata?: Meta;
}

export interface TeamAgentRecord<Meta extends Record<string, unknown> = Record<string, unknown>> {
  id: AgentId;
  teamId: TeamId;
  role: AgentRole;
  name: string;
  status: AgentStatus;
  cwd?: string;
  currentTaskId?: TaskId;
  sessionRef?: AgentSessionRef;
  createdAt: number;
  updatedAt: number;
  metadata?: Meta;
}

export interface AgentSessionRef<Meta extends Record<string, unknown> = Record<string, unknown>> {
  sessionId: string;
  provider: string;
  displayName?: string;
  metadata?: Meta;
}

export interface TeamTaskRecord<Meta extends Record<string, unknown> = Record<string, unknown>> {
  id: TaskId;
  teamId: TeamId;
  title: string;
  description: string;
  status: TaskStatus;
  ownerAgentId?: AgentId;
  deps: TaskId[];
  result?: string;
  blockedReason?: string;
  createdBy: AgentId | 'human' | 'runtime';
  createdAt: number;
  updatedAt: number;
  metadata?: Meta;
}

export interface TeamArtifactRecord<Meta extends Record<string, unknown> = Record<string, unknown>> {
  id: ArtifactId;
  teamId: TeamId;
  taskId?: TaskId;
  agentId?: AgentId;
  kind: ArtifactKind;
  title: string;
  uri?: string;
  summary?: string;
  createdAt: number;
  metadata?: Meta;
}

export interface HumanGateRecord<Meta extends Record<string, unknown> = Record<string, unknown>> {
  id: HumanGateId;
  teamId: TeamId;
  taskId?: TaskId;
  agentId?: AgentId;
  reason: string;
  prompt: string;
  status: HumanGateStatus;
  answer?: string;
  createdAt: number;
  updatedAt: number;
  metadata?: Meta;
}

export type TeamEventType =
  | 'team_created'
  | 'team_status_changed'
  | 'agent_added'
  | 'agent_status_changed'
  | 'task_created'
  | 'task_assigned'
  | 'task_started'
  | 'task_completed'
  | 'task_failed'
  | 'task_blocked'
  | 'task_needs_review'
  | 'human_gate_opened'
  | 'human_gate_answered'
  | 'message_sent'
  | 'artifact_created'
  | 'dispatch_paused'
  | 'dispatch_resumed'
  | 'round_checkpoint_entered'
  | 'round_advanced'
  | 'runtime_error';

export interface TeamEvent<Payload extends Record<string, unknown> = Record<string, unknown>> {
  id: TeamEventId;
  teamId: TeamId;
  type: TeamEventType;
  timestamp: number;
  actor: AgentId | 'human' | 'runtime';
  payload: Payload;
}

export type MailboxMessageType =
  | 'task_assigned'
  | 'task_completed'
  | 'task_blocked'
  | 'question'
  | 'answer'
  | 'broadcast'
  | 'context_shared'
  | 'artifact_created'
  | 'interrupt'
  | 'status_update';

export interface MailboxMessage<Meta extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  teamId: TeamId;
  from: AgentId | 'human' | 'runtime';
  to: AgentId | 'lead' | 'all';
  type: MailboxMessageType;
  content: string;
  taskId?: TaskId;
  createdAt: number;
  readAt?: number;
  metadata?: Meta;
}

export interface AgentSessionEvent {
  sessionId: string;
  type: 'started' | 'output' | 'idle' | 'needs_input' | 'completed' | 'failed' | 'stopped';
  text?: string;
  taskId?: TaskId;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateAgentSessionInput {
  teamId: TeamId;
  agentId: AgentId;
  name: string;
  role: AgentRole;
  cwd?: string;
  prompt?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentSessionAdapter {
  createSession(input: CreateAgentSessionInput): Promise<AgentSessionRef>;
  sendInput(sessionId: string, input: string): Promise<void>;
  interrupt(sessionId: string, mode: 'soft' | 'ctrl-c' | 'abort'): Promise<void>;
  getStatus(sessionId: string): Promise<AgentStatus>;
  /**
   * Optionally persist the prompt a restart/relaunch should replay for this
   * session. Called when a task is dispatched to the agent so a later restart
   * replays the agent's CURRENT task instead of a previously finished one.
   * Adapters whose sessions resume by other means can omit this.
   */
  persistLaunchPrompt?(sessionId: string, prompt: string): Promise<void>;
  onEvent?(handler: (event: AgentSessionEvent) => void): () => void;
}

export interface TeamRuntimeStore {
  saveTeam(team: AgentTeamRecord): Promise<void>;
  getTeam(teamId: TeamId): Promise<AgentTeamRecord | undefined>;
  deleteTeam(teamId: TeamId): Promise<void>;

  saveAgent(agent: TeamAgentRecord): Promise<void>;
  getAgent(agentId: AgentId): Promise<TeamAgentRecord | undefined>;
  listAgents(teamId: TeamId): Promise<TeamAgentRecord[]>;

  saveTask(task: TeamTaskRecord): Promise<void>;
  getTask(taskId: TaskId): Promise<TeamTaskRecord | undefined>;
  listTasks(teamId: TeamId): Promise<TeamTaskRecord[]>;

  saveArtifact(artifact: TeamArtifactRecord): Promise<void>;
  listArtifacts(teamId: TeamId): Promise<TeamArtifactRecord[]>;

  saveHumanGate(gate: HumanGateRecord): Promise<void>;
  getHumanGate(gateId: HumanGateId): Promise<HumanGateRecord | undefined>;
  listHumanGates(teamId: TeamId): Promise<HumanGateRecord[]>;

  appendEvent(event: TeamEvent): Promise<void>;
  listEvents(teamId: TeamId): Promise<TeamEvent[]>;

  appendMessage(message: MailboxMessage): Promise<void>;
  listMessages(teamId: TeamId): Promise<MailboxMessage[]>;
}

export interface CreateTeamInput {
  id?: TeamId;
  name: string;
  goal: string;
  metadata?: Record<string, unknown>;
}

export interface AddAgentInput {
  id?: AgentId;
  teamId: TeamId;
  role: AgentRole;
  name: string;
  cwd?: string;
  sessionRef?: AgentSessionRef;
  metadata?: Record<string, unknown>;
}

export interface CreateTaskInput {
  id?: TaskId;
  teamId: TeamId;
  title: string;
  description: string;
  ownerAgentId?: AgentId;
  deps?: TaskId[];
  createdBy?: AgentId | 'human' | 'runtime';
  metadata?: Record<string, unknown>;
}

export interface CreateArtifactInput {
  id?: ArtifactId;
  teamId: TeamId;
  taskId?: TaskId;
  agentId?: AgentId;
  kind: ArtifactKind;
  title: string;
  uri?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export interface OpenHumanGateInput {
  id?: HumanGateId;
  teamId: TeamId;
  taskId?: TaskId;
  agentId?: AgentId;
  reason: string;
  prompt: string;
  metadata?: Record<string, unknown>;
}

export interface RuntimeSnapshot {
  team: AgentTeamRecord;
  agents: TeamAgentRecord[];
  tasks: TeamTaskRecord[];
  artifacts: TeamArtifactRecord[];
  humanGates: HumanGateRecord[];
  events: TeamEvent[];
  messages: MailboxMessage[];
  checkpointRound?: number;
  totalRounds?: number;
}

export interface DispatchResult {
  assigned: TeamTaskRecord[];
  idleAgents: TeamAgentRecord[];
}
